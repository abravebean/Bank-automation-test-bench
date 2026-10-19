require('dotenv').config();
const { launchPage } = require('../lib/pw-browser');
const { LoginPage } = require('../playwright/pages/LoginPage');
const { AccountsPage } = require('../playwright/pages/bank/AccountsPage');
const { TransferPage } = require('../playwright/pages/bank/TransferPage');

// The built-in Ledgerline demo bank on this server (set by server.js).
const LEDGERLINE_URL = process.env.LEDGERLINE_URL;

/** "$3,250.00" -> 325000 */
const cents = (text) => Math.round(Number(text.replace(/[^0-9.]/g, '')) * 100);

module.exports = {
  name: 'transfer-playwright',
  engine: 'playwright',
  area: 'Banking',
  description: 'Moves $10.00 from checking to savings in Ledgerline and checks the receipt and both new balances.',
  async run(log) {
    if (!LEDGERLINE_URL) throw new Error('LEDGERLINE_URL is not set (start the dashboard with npm start)');

    log('Launching Chromium (Playwright)...');
    const { browser, page } = await launchPage({ baseURL: new URL(LEDGERLINE_URL).origin });
    try {
      log('Signing in to Ledgerline as demo_user...');
      const login = new LoginPage(page);
      await login.goto(LEDGERLINE_URL);
      await login.login('demo_user', 'demo_pass');
      const accounts = new AccountsPage(page);
      await accounts.heading.waitFor();

      const checkingBefore = cents(await accounts.balanceOf(accounts.checking));
      const savingsBefore = cents(await accounts.balanceOf(accounts.savings));
      log(`Balances before: checking ${(checkingBefore / 100).toFixed(2)}, savings ${(savingsBefore / 100).toFixed(2)}`);

      log('Transferring $10.00 from checking to savings...');
      await accounts.transferButton.click();
      const transfer = new TransferPage(page);
      await transfer.send('10.00', { memo: 'Dashboard test' });
      await transfer.receipt.waitFor({ state: 'visible' });
      const reference = (await transfer.receiptReference.innerText()).trim();
      log(`Receipt shown, reference ${reference}`);

      await page.goto(LEDGERLINE_URL + '#/accounts');
      await accounts.checking.waitFor();
      const checkingAfter = cents(await accounts.balanceOf(accounts.checking));
      const savingsAfter = cents(await accounts.balanceOf(accounts.savings));
      log(`Balances after: checking ${(checkingAfter / 100).toFixed(2)}, savings ${(savingsAfter / 100).toFixed(2)}`);

      if (checkingAfter !== checkingBefore - 1000) throw new Error(`Checking should drop by $10.00, went from ${checkingBefore} to ${checkingAfter} cents`);
      if (savingsAfter !== savingsBefore + 1000) throw new Error(`Savings should rise by $10.00, went from ${savingsBefore} to ${savingsAfter} cents`);

      log('Signing out...');
      await accounts.signOut.click();
      return `Transfer ${reference} complete: checking −$10.00, savings +$10.00, totals match.`;
    } finally {
      await browser.close();
    }
  },
};
