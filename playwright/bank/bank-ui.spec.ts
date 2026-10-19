// End-to-end UI tests for the Ledgerline demo bank, through the Page Objects.
// Each test signs in as its own fresh customer created through the test-only API.
import { test as base, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { LoginPage } from '../pages/LoginPage';
import { AccountsPage } from '../pages/bank/AccountsPage';
import { TransferPage } from '../pages/bank/TransferPage';
import { HistoryPage } from '../pages/bank/HistoryPage';
import { createCustomer, type TestCustomer } from '../support/bank';
import { captureEvidence } from '../support/evidence';

// A signed-in customer with $1,000.00 checking / $5,000.00 savings, ready on the accounts page.
const test = base.extend<{ customer: TestCustomer; accounts: AccountsPage }>({
  customer: async ({ request }, use) => use(await createCustomer(request, { name: 'Sam Carter' })),
  accounts: async ({ page, customer }, use) => {
    const login = new LoginPage(page);
    await login.goto('/bank/');
    await login.login(customer.username, customer.password);
    const accounts = new AccountsPage(page);
    await expect(accounts.heading).toHaveText('Welcome back, Sam');
    await use(accounts);
  },
});

test.describe('Transfers', { tag: '@R18' }, () => {
  test('a transfer shows a receipt and updates both balances and the history', async ({ page, accounts }, testInfo) => {
    await expect(accounts.checking).toContainText('$1,000.00');
    await expect(accounts.savings).toContainText('$5,000.00');

    const transfer = new TransferPage(page);
    await accounts.transferButton.click();
    await transfer.send('125.50', { memo: 'Rent buffer' });

    await expect(transfer.receipt).toBeVisible();
    await expect(transfer.receiptAmount).toHaveText('$125.50');
    await expect(transfer.receiptReference).toHaveText(/^LL-\d+$/);
    await expect(transfer.receipt).toContainText('new balance $874.50');
    await expect(transfer.receipt).toContainText('new balance $5,125.50');
    await captureEvidence(page, testInfo, 'Transfer receipt');

    await page.getByRole('link', { name: 'Back to accounts' }).last().click();
    await expect(accounts.checking).toContainText('$874.50');
    await expect(accounts.dailyLimit).toContainText('Transferred today: $125.50 of your $2,500.00 daily limit');

    await accounts.checking.click();
    const history = new HistoryPage(page);
    await expect(history.balance).toHaveText('Available balance $874.50');
    expect(await history.row(0)).toEqual([expect.any(String), 'Transfer to High-Yield Savings: Rent buffer', '-$125.50', '$874.50']);
    expect((await history.row(1)).slice(1)).toEqual(['Opening deposit', '$1,000.00', '$1,000.00']);
    await captureEvidence(page, testInfo, 'Checking history after the transfer');
  });

  test('insufficient funds is explained and the amount field is flagged', async ({ page, accounts }, testInfo) => {
    await accounts.transferButton.click();
    const transfer = new TransferPage(page);
    await transfer.send('1000.01');
    await expect(transfer.error).toHaveText('Insufficient funds: Everyday Checking has $1,000.00 available');
    await expect(transfer.amount).toHaveAttribute('aria-invalid', 'true');
    await expect(transfer.receipt).toBeHidden();
    await captureEvidence(page, testInfo, 'Insufficient funds error');
  });

  test('double-clicking Transfer moves the money once', async ({ page, accounts }) => {
    await accounts.transferButton.click();
    const transfer = new TransferPage(page);
    await transfer.amount.fill('10.00');
    await transfer.submit.dblclick();
    await expect(transfer.receipt).toBeVisible();
    await page.goto('/bank/#/accounts');
    await expect(accounts.checking).toContainText('$990.00');
  });
});

test.describe('Amount validation in the form', { tag: '@R17' }, () => {
  for (const [amount, message] of [
    ['0', 'Amount must be more than $0.00'],
    ['12.345', 'Enter an amount like 25 or 25.50 (up to two decimal places)'],
    ['abc', 'Enter an amount like 25 or 25.50 (up to two decimal places)'],
  ]) {
    test(`"${amount}" shows: ${message}`, async ({ page, accounts }) => {
      await accounts.transferButton.click();
      const transfer = new TransferPage(page);
      await transfer.send(amount);
      await expect(transfer.error).toHaveText(message);
    });
  }
});

test.describe('Sessions and access', { tag: ['@R19', '@R23'] }, () => {
  test("opening another customer's account shows 'Account not found'", async ({ page, request, accounts }) => {
    const other = await createCustomer(request);
    await expect(accounts.heading).toBeVisible();
    await page.goto(`/bank/#/accounts/${other.checking.id}`);
    await expect(page.locator('#history-title')).toHaveText('Account not found');
    await expect(page.getByTestId('history-table').locator('tbody tr')).toHaveCount(0);
  });

  test('after signing out, the Back button does not show account data', async ({ page, accounts }) => {
    await accounts.checking.click();
    await expect(page.locator('#history-title')).toContainText('Everyday Checking');
    await page.getByTestId('btn-logout').click();
    await expect(page.getByTestId('input-username')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('input-username')).toBeVisible();
    await expect(page.locator('#history-title')).toBeHidden();
  });

  test('the session cookie is not readable from page scripts', async ({ page, accounts }) => {
    await expect(accounts.heading).toBeVisible();
    expect(await page.evaluate(() => document.cookie)).not.toContain('ll_session');
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'll_session')).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
  });
});

test.describe('Sign-in', { tag: '@R20' }, () => {
  test('three wrong passwords lock the account with a clear message', async ({ page, customer }, testInfo) => {
    const login = new LoginPage(page);
    await login.goto('/bank/');
    for (let i = 0; i < 2; i++) {
      await login.login(customer.username, `wrong-${i}`);
      await expect(login.errorMessage).toHaveText('Invalid username or password');
    }
    await login.login(customer.username, 'wrong-2');
    await expect(login.errorMessage).toHaveText('Too many failed attempts. Try again in 15 minutes.');
    await login.login(customer.username, customer.password);
    await expect(login.errorMessage).toHaveText('Too many failed attempts. Try again in 15 minutes.');
    await captureEvidence(page, testInfo, 'Account locked after three failed attempts');
  });
});

test.describe('Accessibility', { tag: '@R24' }, () => {
  const scan = async (page: import('@playwright/test').Page) => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} element(s)`);
  };

  test('sign-in page has no WCAG 2.1 A/AA violations', async ({ page }) => {
    await new LoginPage(page).goto('/bank/');
    await expect(page.getByTestId('input-username')).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test('accounts, transfer (with an error) and history pages have no violations', async ({ page, accounts }) => {
    expect(await scan(page), 'accounts').toEqual([]);
    await accounts.transferButton.click();
    const transfer = new TransferPage(page);
    await transfer.send('99999');
    await expect(transfer.error).toBeVisible();
    expect(await scan(page), 'transfer with error').toEqual([]);
    await page.goto('/bank/#/accounts');
    await accounts.savings.click();
    await expect(page.getByTestId('history-table')).toBeVisible();
    expect(await scan(page), 'history').toEqual([]);
  });
});
