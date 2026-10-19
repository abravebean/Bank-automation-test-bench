// Ledgerline: the signed-in accounts overview.
import type { Locator, Page } from '@playwright/test';

export class AccountsPage {
  readonly heading: Locator;
  readonly checking: Locator;
  readonly savings: Locator;
  readonly dailyLimit: Locator;
  readonly transferButton: Locator;
  readonly signOut: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1, name: /Welcome back/ });
    this.checking = page.getByTestId('account-checking');
    this.savings = page.getByTestId('account-savings');
    this.dailyLimit = page.locator('#limit');
    this.transferButton = page.getByTestId('btn-transfer');
    this.signOut = page.getByTestId('btn-logout');
  }

  /** Balance shown for an account, e.g. "$1,000.00". */
  async balanceOf(account: Locator): Promise<string> {
    return (await account.locator('.acct-balance').innerText()).trim();
  }
}
