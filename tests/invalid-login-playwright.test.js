require('dotenv').config();
const { launchPage } = require('../lib/pw-browser');
const { LoginPage } = require('../playwright/pages/LoginPage');

const BANK_URL = process.env.BANK_URL;

module.exports = {
  name: 'invalid-login-rejected-playwright',
  engine: 'playwright',
  area: 'Login',
  description: 'Playwright version: confirms an incorrect password shows an error and does not reach the welcome screen.',
  async run(log) {
    if (!BANK_URL) {
      throw new Error('Missing BANK_URL in .env');
    }

    log('Launching Chromium (Playwright)...');
    const { browser, page } = await launchPage();
    try {
      const loginPage = new LoginPage(page);

      log(`Navigating to ${BANK_URL}...`);
      await loginPage.goto(BANK_URL);

      log('Entering fake username and wrong password...');
      await loginPage.login('not-a-real-user', 'definitely-wrong-password');

      log('Waiting for error message...');
      await loginPage.errorMessage.waitFor({ state: 'visible', timeout: 5_000 });
      const errorText = (await loginPage.errorMessage.innerText()).trim();
      log(`Error shown: "${errorText}"`);

      if (await loginPage.welcomeHeading.isVisible()) {
        throw new Error('Welcome screen appeared with invalid credentials');
      }

      return `Correctly rejected invalid credentials — error shown: "${errorText}"`;
    } finally {
      log('Closing browser...');
      await browser.close();
    }
  },
};
