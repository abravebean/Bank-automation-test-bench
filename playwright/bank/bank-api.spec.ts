// API tests for the Ledgerline demo bank: business rules, authorization, security,
// data integrity, idempotency and concurrency. Every test uses its own fresh customer.
import { test, expect } from '@playwright/test';
import { balances, createCustomer, integrity, newIdempotencyKey, signedInClient } from '../support/bank';

test.describe('Transfer amount validation (boundary values)', { tag: '@R17' }, () => {
  // Partition / boundary -> expected status. Checking starts at $1,000.00.
  const cases: [string, number, string][] = [
    ['0', 400, 'zero (just below the smallest valid amount)'],
    ['0.01', 201, 'one cent (smallest valid amount)'],
    ['-5.00', 400, 'negative'],
    ['1.234', 400, 'three decimal places'],
    ['ten', 400, 'not a number'],
    ['1e2', 400, 'scientific notation'],
    ['', 400, 'empty'],
    ['999.99', 201, 'just under the balance'],
  ];
  for (const [amount, status, why] of cases) {
    test(`"${amount}" → ${status} (${why})`, async ({ request, playwright, baseURL }) => {
      const customer = await createCustomer(request, { checkingCents: 100_000 });
      const client = await signedInClient(playwright, baseURL!, customer);
      const res = await client.post('/bank/api/transfers', {
        data: { fromAccountId: customer.checking.id, toAccountId: customer.savings.id, amount },
      });
      expect(res.status()).toBe(status);
      if (status === 400) expect((await res.json()).field).toBe('amount');
      // Nothing moves on a rejected transfer.
      if (status !== 201) expect((await balances(client)).checking).toBe(100_000);
    });
  }
});

test.describe('Business rules', { tag: '@R18' }, () => {
  test('balance boundary: exact balance succeeds, then one more cent is 422', async ({ request, playwright, baseURL }) => {
    const customer = await createCustomer(request, { checkingCents: 25_000 });
    const client = await signedInClient(playwright, baseURL!, customer);
    const transfer = (amount: string) =>
      client.post('/bank/api/transfers', { data: { fromAccountId: customer.checking.id, toAccountId: customer.savings.id, amount } });

    expect((await transfer('250.01')).status()).toBe(422);
    expect((await transfer('250.00')).status()).toBe(201);
    const res = await transfer('0.01');
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toMatch(/Insufficient funds.*\$0\.00 available/);
  });

  test('daily limit: $2,500.00 succeeds, the next cent is refused with the amount left', async ({ request, playwright, baseURL }) => {
    const customer = await createCustomer(request, { savingsCents: 1_000_000 });
    const client = await signedInClient(playwright, baseURL!, customer);
    const transfer = (amount: string) =>
      client.post('/bank/api/transfers', { data: { fromAccountId: customer.savings.id, toAccountId: customer.checking.id, amount } });

    expect((await transfer('2500.01')).status()).toBe(422);
    expect((await transfer('1500.00')).status()).toBe(201);
    const over = await transfer('1000.01');
    expect(over.status()).toBe(422);
    expect((await over.json()).error).toContain('You can transfer $1,000.00 more today');
    expect((await transfer('1000.00')).status()).toBe(201);
  });

  test('same source and destination is rejected', async ({ request, playwright, baseURL }) => {
    const customer = await createCustomer(request);
    const client = await signedInClient(playwright, baseURL!, customer);
    const res = await client.post('/bank/api/transfers', {
      data: { fromAccountId: customer.checking.id, toAccountId: customer.checking.id, amount: '5' },
    });
    expect(res.status()).toBe(400);
  });

  test('history lists newest first and every running balance adds up', async ({ request, playwright, baseURL }) => {
    const customer = await createCustomer(request, { checkingCents: 50_000 });
    const client = await signedInClient(playwright, baseURL!, customer);
    for (const amount of ['12.34', '100.00', '0.66']) {
      await client.post('/bank/api/transfers', { data: { fromAccountId: customer.checking.id, toAccountId: customer.savings.id, amount } });
    }
    const { transactions } = await (await client.get(`/bank/api/accounts/${customer.checking.id}/transactions`)).json();
    expect(transactions.map((t: { amountCents: number }) => t.amountCents)).toEqual([-66, -10_000, -1_234, 50_000]);
    // Walking from oldest to newest, each balance = previous balance + this amount.
    const oldestFirst = [...transactions].reverse();
    let running = 0;
    for (const t of oldestFirst) {
      running += t.amountCents;
      expect(t.balanceAfterCents).toBe(running);
    }
    expect(running).toBe((await balances(client)).checking);
  });
});

test.describe('Authorization', { tag: '@R19' }, () => {
  test("a customer can't read another customer's transactions (IDOR)", async ({ request, playwright, baseURL }) => {
    const alice = await createCustomer(request);
    const mallory = await createCustomer(request);
    const client = await signedInClient(playwright, baseURL!, mallory);
    const res = await client.get(`/bank/api/accounts/${alice.checking.id}/transactions`);
    // 404, not 403: don't even confirm the account exists.
    expect(res.status()).toBe(404);
    expect(await res.text()).not.toContain(alice.checking.balance);
  });

  test("a customer can't move money out of someone else's account", async ({ request, playwright, baseURL }) => {
    const alice = await createCustomer(request, { checkingCents: 100_000 });
    const mallory = await createCustomer(request);
    const malloryClient = await signedInClient(playwright, baseURL!, mallory);
    const res = await malloryClient.post('/bank/api/transfers', {
      data: { fromAccountId: alice.checking.id, toAccountId: mallory.savings.id, amount: '500' },
    });
    expect(res.status()).toBe(404);
    const aliceClient = await signedInClient(playwright, baseURL!, alice);
    expect((await balances(aliceClient)).checking).toBe(100_000);
  });

  test('every account route requires a session', async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    for (const [method, url] of [['GET', '/bank/api/me'], ['GET', '/bank/api/accounts'], ['POST', '/bank/api/transfers']] as const) {
      const res = await anonymous.fetch(url, { method, data: method === 'POST' ? {} : undefined });
      expect(res.status(), `${method} ${url}`).toBe(401);
    }
  });

  test('signing out ends the session on the server', async ({ request, playwright, baseURL }) => {
    const customer = await createCustomer(request);
    const client = await signedInClient(playwright, baseURL!, customer);
    const { cookies } = await client.storageState();
    await client.post('/bank/api/logout');
    // Replaying the old cookie must not work: the session was deleted, not just the cookie.
    const replay = await playwright.request.newContext({ baseURL, storageState: { cookies, origins: [] } });
    expect((await replay.get('/bank/api/accounts')).status()).toBe(401);
  });
});

test.describe('Sign-in security', { tag: '@R20' }, () => {
  test('locks after 3 failed attempts; the right password is refused while locked', async ({ request }) => {
    const customer = await createCustomer(request);
    const login = (password: string) => request.post('/bank/api/login', { data: { username: customer.username, password } });
    expect((await login('wrong-1')).status()).toBe(401);
    expect((await login('wrong-2')).status()).toBe(401);
    expect((await login('wrong-3')).status()).toBe(423);
    const locked = await login(customer.password);
    expect(locked.status()).toBe(423);
    expect((await locked.json()).error).toMatch(/Try again in 15 minutes/);
  });

  test("responses don't reveal whether a username exists", async ({ request }) => {
    const customer = await createCustomer(request);
    const attempts = async (username: string) => {
      const out: string[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await request.post('/bank/api/login', { data: { username, password: 'wrong' } });
        out.push(`${res.status()} ${(await res.json()).error}`);
      }
      return out;
    };
    expect(await attempts(`ghost_${Date.now()}`)).toEqual(await attempts(customer.username));
  });
});

test.describe('Session cookie', { tag: '@R23' }, () => {
  test('is HttpOnly, SameSite=Strict and scoped to /bank', async ({ request }) => {
    const res = await request.post('/bank/api/login', { data: { username: 'demo_user', password: 'demo_pass' } });
    const cookie = res.headers()['set-cookie'] ?? '';
    expect(cookie).toMatch(/^ll_session=[0-9a-f]{48};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/bank');
  });
});

test.describe('Ledger integrity', { tag: '@R21' }, () => {
  test('transfers never change the total money held by the bank, and every ledger reconciles', async ({ request, playwright, baseURL }) => {
    const customer = await createCustomer(request);
    const client = await signedInClient(playwright, baseURL!, customer);
    const before = await integrity(request);
    // A valid transfer, then one rejected for insufficient funds.
    await client.post('/bank/api/transfers', { data: { fromAccountId: customer.checking.id, toAccountId: customer.savings.id, amount: '321.09' } });
    await client.post('/bank/api/transfers', { data: { fromAccountId: customer.checking.id, toAccountId: customer.savings.id, amount: '99999' } });
    const after = await integrity(request);
    // Other tests create customers in parallel, so compare this customer's money, plus the global ledger check.
    const b = await balances(client);
    expect(b.checking + b.savings).toBe(customer.checking.balanceCents + customer.savings.balanceCents);
    expect(after.ledgerMismatches).toEqual([]);
    expect(before.ledgerMismatches).toEqual([]);
  });
});

test.describe('Double submits and race conditions', { tag: '@R22' }, () => {
  test('the same Idempotency-Key moves money once and replays the first response', async ({ request, playwright, baseURL }) => {
    const customer = await createCustomer(request, { checkingCents: 100_000 });
    const client = await signedInClient(playwright, baseURL!, customer);
    const key = newIdempotencyKey();
    const send = () =>
      client.post('/bank/api/transfers', {
        headers: { 'Idempotency-Key': key },
        data: { fromAccountId: customer.checking.id, toAccountId: customer.savings.id, amount: '75.00' },
      });
    const first = await send();
    const second = await send();
    expect(first.status()).toBe(201);
    expect(second.status()).toBe(200);
    expect(second.headers()['idempotent-replay']).toBe('true');
    expect((await second.json()).transfer.id).toBe((await first.json()).transfer.id);
    expect((await balances(client)).checking).toBe(100_000 - 7_500);
  });

  test('reusing a key for a different transfer is a 409; a malformed key is a 400', async ({ request, playwright, baseURL }) => {
    const customer = await createCustomer(request);
    const client = await signedInClient(playwright, baseURL!, customer);
    const key = newIdempotencyKey();
    const body = (amount: string) => ({ fromAccountId: customer.checking.id, toAccountId: customer.savings.id, amount });
    expect((await client.post('/bank/api/transfers', { headers: { 'Idempotency-Key': key }, data: body('10') })).status()).toBe(201);
    expect((await client.post('/bank/api/transfers', { headers: { 'Idempotency-Key': key }, data: body('11') })).status()).toBe(409);
    expect((await client.post('/bank/api/transfers', { headers: { 'Idempotency-Key': 'bad key!' }, data: body('10') })).status()).toBe(400);
  });

  test('20 simultaneous $100 transfers from a $1,000 balance: exactly 10 succeed, never overdrawn', async ({ request, playwright, baseURL }) => {
    const customer = await createCustomer(request, { checkingCents: 100_000 });
    const client = await signedInClient(playwright, baseURL!, customer);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        client.post('/bank/api/transfers', {
          data: { fromAccountId: customer.checking.id, toAccountId: customer.savings.id, amount: '100.00' },
        })
      )
    );
    const statuses = results.map((r) => r.status());
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 422)).toHaveLength(10);
    expect((await balances(client)).checking).toBe(0);
    expect((await integrity(request)).ledgerMismatches).toEqual([]);
  });
});
