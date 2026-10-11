require('dotenv').config();
const { launchPage } = require('../lib/pw-browser');
const { LoginPage } = require('../playwright/pages/LoginPage');

const BANK_URL = process.env.BANK_URL;
const USERNAME = process.env.BANK_USERNAME;
const PASSWORD = process.env.BANK_PASSWORD;

module.exports = {
  name: 'login-playwright',
  engine: 'playwright',
  description: 'Playwright version: logs in with valid credentials and confirms the welcome screen appears.',
  async run(log) {
    if (!BANK_URL || !USERNAME || !PASSWORD) {
      throw new Error('Missing BANK_URL / BANK_USERNAME / BANK_PASSWORD in .env');
    }

    log('Launching Chromium (Playwright)...');
    const { browser, page } = await launchPage();
    try {
      const loginPage = new LoginPage(page);

      log(`Navigating to ${BANK_URL}...`);
      await loginPage.goto(BANK_URL);

      log('Filling credentials and clicking login...');
      await loginPage.login(USERNAME, PASSWORD);

      log('Waiting for welcome screen...');
      await loginPage.welcomeHeading.waitFor({ state: 'visible', timeout: 15_000 });
      log('Welcome screen found — login succeeded.');

      log('Logging out...');
      await loginPage.logout();

      return 'Login succeeded — welcome screen detected, logged out.';
    } finally {
      log('Closing browser...');
      await browser.close();
    }
  },
};
