// Unit tests for the demo bank's business rules (lib/demo-bank/bank.js), no server or browser.
// Uses ISTQB techniques: equivalence partitioning and boundary value analysis for amounts,
// an injectable clock for time-based rules, and a randomized invariant check for the ledger.
import { test, expect } from '@playwright/test';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Bank, RULES, parseAmountToCents, formatCents } = require('../../lib/demo-bank/bank');

/** A clock the test controls, so lockout and daily limits can be tested without waiting. */
function clock(start = '2026-03-10T15:00:00Z') {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), advanceMinutes: (m: number) => (t += m * 60_000), set: (iso: string) => (t = new Date(iso).getTime()) };
}

function customerWith(bank: InstanceType<typeof Bank>, checkingCents = 100_000, savingsCents = 500_000) {
  const username = `u${Math.random().toString(36).slice(2, 8)}`;
  const customer = bank.createCustomer({ username, password: 'pw-123456', name: 'Test', checkingCents, savingsCents });
  const [checking, savings] = bank.accountsFor(customer);
  return { customer, checking, savings };
}

test.describe('Amount parsing: equivalence partitions and boundaries', { tag: '@R17' }, () => {
  const valid: [string, number][] = [
    ['0.01', 1], // smallest valid amount (lower boundary)
    ['1', 100],
    ['25.5', 2550],
    ['25.50', 2550],
    ['1,250.00', 125_000],
    ['1000000', 100_000_000], // largest valid amount (upper boundary)
  ];
  for (const [input, cents] of valid) {
    test(`accepts "${input}" as ${cents} cents`, () => expect(parseAmountToCents(input)).toBe(cents));
  }

  const invalid: [string, RegExp][] = [
    ['0', /more than \$0\.00/], // just below the lower boundary
    ['0.00', /more than \$0\.00/],
    ['1000000.01', /too large/], // just above the upper boundary
    ['1.234', /two decimal places/], // three decimals
    ['-5', /two decimal places/], // negative
    ['abc', /two decimal places/],
    ['', /two decimal places/],
    ['1e3', /two decimal places/], // scientific notation
    ['12.', /two decimal places/],
  ];
  for (const [input, message] of invalid) {
    test(`rejects "${input}"`, () => expect(() => parseAmountToCents(input)).toThrow(message));
  }

  test('never uses floating point: 0.1 + 0.2 stays exact', () => {
    expect(parseAmountToCents('0.10') + parseAmountToCents('0.20')).toBe(parseAmountToCents('0.30'));
  });

  test('formats cents for display', () => {
    expect(formatCents(123_456_789)).toBe('$1,234,567.89');
    expect(formatCents(-2550)).toBe('-$25.50');
    expect(formatCents(5)).toBe('$0.05');
  });
});

test.describe('Transfer rules', { tag: '@R18' }, () => {
  test('balance boundary: the exact balance is allowed, one cent more is not', () => {
    const bank = new Bank();
    const { customer, checking, savings } = customerWith(bank, 10_000);
    expect(() => bank.transfer(customer, { fromAccountId: checking.id, toAccountId: savings.id, amount: '100.01' })).toThrow(/Insufficient funds/);
    bank.transfer(customer, { fromAccountId: checking.id, toAccountId: savings.id, amount: '100.00' });
    expect(checking.balanceCents).toBe(0);
  });

  test('daily limit boundary: $2,500.00 in total is allowed, one cent more is not', () => {
    const bank = new Bank();
    const { customer, checking, savings } = customerWith(bank, 0, 1_000_000);
    bank.transfer(customer, { fromAccountId: savings.id, toAccountId: checking.id, amount: '2000.00' });
    bank.transfer(customer, { fromAccountId: savings.id, toAccountId: checking.id, amount: '500.00' });
    expect(bank.transferredToday(customer)).toBe(RULES.dailyTransferLimitCents);
    expect(() => bank.transfer(customer, { fromAccountId: savings.id, toAccountId: checking.id, amount: '0.01' })).toThrow(/You can transfer \$0\.00 more today/);
  });

  test('the daily limit resets at midnight UTC', () => {
    const c = clock('2026-03-10T23:59:00Z');
    const bank = new Bank({ now: c.now });
    const { customer, checking, savings } = customerWith(bank, 0, 1_000_000);
    bank.transfer(customer, { fromAccountId: savings.id, toAccountId: checking.id, amount: '2500.00' });
    expect(() => bank.transfer(customer, { fromAccountId: savings.id, toAccountId: checking.id, amount: '1.00' })).toThrow(/Daily transfer limit/);
    c.set('2026-03-11T00:00:00Z');
    expect(() => bank.transfer(customer, { fromAccountId: savings.id, toAccountId: checking.id, amount: '1.00' })).not.toThrow();
  });

  test('cannot transfer to the same account', () => {
    const bank = new Bank();
    const { customer, checking } = customerWith(bank);
    expect(() => bank.transfer(customer, { fromAccountId: checking.id, toAccountId: checking.id, amount: '5' })).toThrow(/two different accounts/);
  });
});

test.describe('Ownership', { tag: '@R19' }, () => {
  test("one customer can't read or move another customer's money", () => {
    const bank = new Bank();
    const a = customerWith(bank);
    const b = customerWith(bank);
    expect(() => bank.history(b.customer, a.checking.id)).toThrow(/Account not found/);
    expect(() => bank.transfer(b.customer, { fromAccountId: a.checking.id, toAccountId: b.savings.id, amount: '10' })).toThrow(/Account not found/);
    expect(a.checking.balanceCents).toBe(100_000);
  });
});

test.describe('Login lockout', { tag: '@R20' }, () => {
  test('locks after 3 failures, even with the right password, and unlocks after 15 minutes', () => {
    const c = clock();
    const bank = new Bank({ now: c.now });
    for (let i = 0; i < RULES.maxFailedLogins - 1; i++) expect(() => bank.login('jordan', 'wrong')).toThrow(/Invalid username or password/);
    expect(() => bank.login('jordan', 'wrong')).toThrow(/Too many failed attempts/);
    expect(() => bank.login('jordan', 'jordan_pass')).toThrow(/Too many failed attempts/);
    c.advanceMinutes(14);
    expect(() => bank.login('jordan', 'jordan_pass')).toThrow(/Too many failed attempts/);
    c.advanceMinutes(1);
    expect(bank.login('jordan', 'jordan_pass').customer.name).toBe('Jordan Lee');
  });

  test('an unknown username gets exactly the same responses (no username enumeration)', () => {
    const bank = new Bank();
    const messages = (user: string) =>
      [1, 2, 3].map(() => {
        try {
          bank.login(user, 'wrong');
        } catch (e) {
          return `${(e as { status: number }).status} ${(e as Error).message}`;
        }
        return 'ok';
      });
    expect(messages('no-such-user')).toEqual(messages('jordan'));
  });
});

test.describe('Ledger integrity', { tag: '@R21' }, () => {
  test('500 random transfers never create or destroy money', () => {
    // Small deterministic random generator, so a failure can be reproduced exactly.
    let seed = 42;
    const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);

    const bank = new Bank();
    const customers = Array.from({ length: 5 }, () => customerWith(bank, 200_000, 200_000));
    const before = bank.totalHoldingsCents();
    let ok = 0;
    for (let i = 0; i < 500; i++) {
      const { customer, checking, savings } = customers[Math.floor(rand() * customers.length)]!;
      const [from, to] = rand() < 0.5 ? [checking, savings] : [savings, checking];
      const amount = (Math.floor(rand() * 60_000) / 100).toFixed(2); // $0.00 – $599.99, some invalid
      try {
        bank.transfer(customer, { fromAccountId: from.id, toAccountId: to.id, amount });
        ok++;
      } catch {
        /* rejected by a rule: also fine, as long as nothing moved */
      }
      for (const { checking: c, savings: s } of customers) {
        expect(c.balanceCents).toBeGreaterThanOrEqual(0);
        expect(s.balanceCents).toBeGreaterThanOrEqual(0);
      }
    }
    expect(ok).toBeGreaterThan(50); // the run actually exercised transfers
    expect(bank.totalHoldingsCents()).toBe(before);
    expect(bank.ledgerMismatches()).toEqual([]);
  });

  test('each transaction records the running balance', () => {
    const bank = new Bank();
    const { customer, checking, savings } = customerWith(bank, 10_000);
    bank.transfer(customer, { fromAccountId: checking.id, toAccountId: savings.id, amount: '30' });
    bank.transfer(customer, { fromAccountId: checking.id, toAccountId: savings.id, amount: '20.25' });
    const history = bank.history(customer, checking.id); // newest first
    expect(history.map((t: { balanceAfterCents: number }) => t.balanceAfterCents)).toEqual([4_975, 7_000, 10_000]);
  });
});

test.describe('Idempotency', { tag: '@R22' }, () => {
  test('replaying the same key returns the first result and moves money once', () => {
    const bank = new Bank();
    const { customer, checking, savings } = customerWith(bank);
    const body = { fromAccountId: checking.id, toAccountId: savings.id, amount: '40' };
    const first = bank.transfer(customer, body, 'key-12345678');
    const second = bank.transfer(customer, body, 'key-12345678');
    expect(second.replayed).toBe(true);
    expect(second.transfer.id).toBe(first.transfer.id);
    expect(checking.balanceCents).toBe(100_000 - 4_000);
  });

  test('reusing a key for a different transfer is refused', () => {
    const bank = new Bank();
    const { customer, checking, savings } = customerWith(bank);
    bank.transfer(customer, { fromAccountId: checking.id, toAccountId: savings.id, amount: '40' }, 'key-12345678');
    expect(() => bank.transfer(customer, { fromAccountId: checking.id, toAccountId: savings.id, amount: '41' }, 'key-12345678')).toThrow(/already used/);
  });
});
