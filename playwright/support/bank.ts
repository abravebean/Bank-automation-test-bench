// Helpers for testing the Ledgerline demo bank.
// Each test creates its own customer through a test-only route, so tests can run in
// parallel without sharing balances, daily limits or lockout counters.
import { expect, type APIRequest, type APIRequestContext } from '@playwright/test';

export interface BankAccount {
  id: string;
  type: 'checking' | 'savings';
  name: string;
  number: string;
  balanceCents: number;
  balance: string;
}

export interface TestCustomer {
  username: string;
  password: string;
  name: string;
  accounts: BankAccount[];
  checking: BankAccount;
  savings: BankAccount;
}

export async function createCustomer(
  request: APIRequestContext,
  opts: { name?: string; checkingCents?: number; savingsCents?: number } = {}
): Promise<TestCustomer> {
  const res = await request.post('/bank/api/test/customers', { data: opts });
  expect(res.status(), 'test hook available (DEMO_BANK_TEST_HOOKS=true)').toBe(201);
  const body = await res.json();
  const checking = body.accounts.find((a: BankAccount) => a.type === 'checking');
  const savings = body.accounts.find((a: BankAccount) => a.type === 'savings');
  return { ...body, checking, savings };
}

/** A separate API client with its own cookie jar, signed in as `customer`. */
export async function signedInClient(playwright: { request: APIRequest }, baseURL: string, customer: { username: string; password: string }) {
  const client = await playwright.request.newContext({ baseURL });
  const res = await client.post('/bank/api/login', { data: { username: customer.username, password: customer.password } });
  expect(res.status()).toBe(200);
  return client;
}

export async function balances(client: APIRequestContext): Promise<Record<string, number>> {
  const { accounts } = await (await client.get('/bank/api/accounts')).json();
  return Object.fromEntries(accounts.map((a: BankAccount) => [a.type, a.balanceCents]));
}

export async function integrity(request: APIRequestContext): Promise<{ totalHoldingsCents: number; ledgerMismatches: string[] }> {
  return (await request.get('/bank/api/test/integrity')).json();
}

let keyCounter = 0;
export const newIdempotencyKey = () => `test-${Date.now().toString(36)}-${(keyCounter++).toString(36)}`;
