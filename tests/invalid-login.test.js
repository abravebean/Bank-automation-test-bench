require('dotenv').config();
const { until } = require('selenium-webdriver');
const { buildDriver } = require('../lib/driver');
const { SELECTORS } = require('../lib/selectors');

const BANK_URL = process.env.BANK_URL;
const IMPLICIT_WAIT_MS = 10000;

module.exports = {
  name: 'invalid-login-rejected',
  engine: 'selenium',
  area: 'Login',
  description: 'Confirms an incorrect password shows an error and does not reach the welcome screen.',
  async run(log) {
    if (!BANK_URL) {
      throw new Error('Missing BANK_URL in .env');
    }

    log('Launching browser...');
    const driver = await buildDriver();
    try {
      log(`Navigating to ${BANK_URL}...`);
      await driver.get(BANK_URL);
      await driver.manage().setTimeouts({ implicit: IMPLICIT_WAIT_MS });

      log('Locating username field...');
      const usernameEl = await driver.wait(
        until.elementLocated(SELECTORS.usernameField),
        IMPLICIT_WAIT_MS
      );
      log('Entering fake username...');
      await usernameEl.sendKeys('not-a-real-user');

      log('Entering wrong password...');
      const passwordEl = await driver.findElement(SELECTORS.passwordField);
      await passwordEl.sendKeys('definitely-wrong-password');

      log('Clicking login...');
      const submitEl = await driver.findElement(SELECTORS.submitButton);
      await submitEl.click();

      log('Waiting for error message...');
      const errorEl = await driver.wait(until.elementLocated(SELECTORS.errorMessage), 5000);
      const errorText = await errorEl.getText();
      log(`Error shown: "${errorText}"`);

      return `Correctly rejected invalid credentials — error shown: "${errorText}"`;
    } finally {
      log('Closing browser in 5 seconds...');
      await driver.sleep(5000);
      await driver.quit();
    }
  },
};