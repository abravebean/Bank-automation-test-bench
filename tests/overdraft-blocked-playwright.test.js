require('dotenv').config();
const { launchPage } = require('../lib/pw-browser');
const { LoginPage } = require('../playwright/pages/LoginPage');
const { AccountsPage } = require('../playwright/pages/bank/AccountsPage');
const { TransferPage } = require('../playwright/pages/bank/TransferPage');

const LEDGERLINE_URL = process.env.LEDGERLINE_URL;

module.exports = {
  name: 'overdraft-blocked-playwright',
  engine: 'playwright',
  area: 'Banking',
  description: 'Tries to transfer more than the checking balance and confirms Ledgerline refuses it and nothing moves.',
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
      const before = await accounts.balanceOf(accounts.checking);
      log(`Checking balance: ${before}`);

      log('Trying to transfer $999,999.99...');
      await accounts.transferButton.click();
      const transfer = new TransferPage(page);
      await transfer.send('999999.99');
      await transfer.error.waitFor({ state: 'visible' });
      const message = (await transfer.error.innerText()).trim();
      log(`Error shown: "${message}"`);
      if (!message.startsWith('Insufficient funds')) throw new Error(`Expected an insufficient-funds error, got "${message}"`);
      if (await transfer.receipt.isVisible()) throw new Error('A receipt appeared for a refused transfer');

      await page.goto(LEDGERLINE_URL + '#/accounts');
      await accounts.checking.waitFor();
      const after = await accounts.balanceOf(accounts.checking);
      if (after !== before) throw new Error(`Balance changed from ${before} to ${after}`);
      log(`Balance unchanged: ${after}`);

      await accounts.signOut.click();
      return `Overdraft refused ("${message}") and the balance stayed ${after}.`;
    } finally {
      await browser.close();
    }
  },
};
