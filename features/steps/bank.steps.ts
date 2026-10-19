import { expect } from '@playwright/test';
import { Given, When, Then } from './fixtures';
import { LoginPage } from '../../playwright/pages/LoginPage';
import { AccountsPage } from '../../playwright/pages/bank/AccountsPage';
import { TransferPage } from '../../playwright/pages/bank/TransferPage';
import { createCustomer } from '../../playwright/support/bank';
import { captureEvidence } from '../../playwright/support/evidence';

const ACCOUNT = { checking: 'Everyday Checking', savings: 'High-Yield Savings' } as const;

/** "$1,000.00" -> 100000 */
function cents(money: string): number {
  return Math.round(Number(money.replace(/[$,]/g, '')) * 100);
}

Given('I am signed in with {string} in checking and {string} in savings', async ({ page, request }, checking: string, savings: string) => {
  // A fresh customer per scenario: balances and the daily limit never leak between scenarios.
  const customer = await createCustomer(request, { name: 'Riley Morgan', checkingCents: cents(checking), savingsCents: cents(savings) });
  const login = new LoginPage(page);
  await login.goto('/bank/');
  await login.login(customer.username, customer.password);
  await expect(new AccountsPage(page).heading).toHaveText('Welcome back, Riley');
});

When('I transfer {string} from {word} to {word}', async ({ page }, amount: string, from: string, to: string) => {
  await page.goto('/bank/#/accounts');
  const transfer = new TransferPage(page);
  await transfer.goto();
  await transfer.send(amount, { from: ACCOUNT[from as keyof typeof ACCOUNT], to: ACCOUNT[to as keyof typeof ACCOUNT] });
});

Then('the transfer succeeds', async ({ page, $testInfo }) => {
  const transfer = new TransferPage(page);
  await expect(transfer.receipt).toContainText('Transfer complete');
  await expect(transfer.receiptReference).toHaveText(/^LL-\d+$/);
  await captureEvidence(page, $testInfo, 'Transfer receipt');
});

Then('I see {string}', async ({ page, $testInfo }, text: string) => {
  const transfer = new TransferPage(page);
  // Either the receipt or the error message, whichever the bank showed.
  await expect(transfer.receipt.or(transfer.error).filter({ visible: true })).toContainText(text);
  await captureEvidence(page, $testInfo, `Result: ${text}`);
});

Then('my {word} balance is {string}', async ({ page }, account: string, balance: string) => {
  await page.goto('/bank/#/accounts');
  const accounts = new AccountsPage(page);
  const row = account === 'checking' ? accounts.checking : accounts.savings;
  await expect(row.locator('.acct-balance')).toHaveText(balance);
});
