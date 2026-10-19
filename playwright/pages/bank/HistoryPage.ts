// Ledgerline: one account's transaction history.
import type { Locator, Page } from '@playwright/test';

export class HistoryPage {
  readonly title: Locator;
  readonly balance: Locator;
  readonly rows: Locator;

  constructor(readonly page: Page) {
    this.title = page.locator('#history-title');
    this.balance = page.locator('#history-balance');
    this.rows = page.getByTestId('history-table').locator('tbody tr');
  }

  /** Cells of row `i` (0 = newest): [date, description, amount, balance]. */
  async row(i: number): Promise<string[]> {
    return this.rows.nth(i).locator('td').allInnerTexts();
  }
}
