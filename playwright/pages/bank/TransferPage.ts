// Ledgerline: transfer between your own accounts.
import type { Locator, Page } from '@playwright/test';

export class TransferPage {
  readonly from: Locator;
  readonly to: Locator;
  readonly amount: Locator;
  readonly memo: Locator;
  readonly submit: Locator;
  readonly error: Locator;
  readonly receipt: Locator;
  readonly receiptAmount: Locator;
  readonly receiptReference: Locator;

  constructor(readonly page: Page) {
    this.from = page.getByLabel('From');
    this.to = page.getByLabel('To', { exact: true });
    this.amount = page.getByLabel('Amount');
    this.memo = page.getByLabel(/Memo/);
    this.submit = page.getByRole('button', { name: 'Transfer', exact: true });
    this.error = page.getByTestId('transfer-error');
    this.receipt = page.getByTestId('transfer-success');
    this.receiptAmount = page.getByTestId('receipt-amount');
    this.receiptReference = page.getByTestId('receipt-reference');
  }

  async goto(): Promise<void> {
    await this.page.goto('/bank/#/transfer');
    await this.amount.waitFor();
  }

  /** Options read "Everyday Checking ••••1234 ($1,000.00)", so match on the name they start with. */
  private async choose(select: Locator, accountName: string): Promise<void> {
    const value = await select.locator('option', { hasText: accountName }).first().getAttribute('value');
    if (!value) throw new Error(`No "${accountName}" option`);
    await select.selectOption(value);
  }

  /** Picks accounts by their visible name, e.g. "Everyday Checking". */
  async send(amount: string, { from = 'Everyday Checking', to = 'High-Yield Savings', memo = '' } = {}): Promise<void> {
    await this.choose(this.from, from);
    await this.choose(this.to, to);
    await this.amount.fill(amount);
    if (memo) await this.memo.fill(memo);
    await this.submit.click();
  }
}
