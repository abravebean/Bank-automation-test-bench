require('dotenv').config();
const { until } = require('selenium-webdriver');
const { buildDriver } = require('../lib/driver');
const { SELECTORS } = require('../lib/selectors');

const BANK_URL = process.env.BANK_URL;
const USERNAME = process.env.BANK_USERNAME;
const PASSWORD = process.env.BANK_PASSWORD;
const IMPLICIT_WAIT_MS = 10000;

module.exports = {
  name: 'login',
  engine: 'selenium',
  area: 'Login',
  description: 'Logs in with valid credentials and confirms the welcome screen appears.',
  async run(log) {
    if (!BANK_URL || !USERNAME || !PASSWORD) {
      throw new Error('Missing BANK_URL / BANK_USERNAME / BANK_PASSWORD in .env');
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
      log('Entering username...');
      await usernameEl.sendKeys(USERNAME);

      log('Entering password...');
      const passwordEl = await driver.findElement(SELECTORS.passwordField);
      await passwordEl.sendKeys(PASSWORD);

      log('Clicking login...');
      const submitEl = await driver.findElement(SELECTORS.submitButton);
      await submitEl.click();

      log('Waiting for welcome screen...');
      await driver.wait(until.elementLocated(SELECTORS.postLoginElement), 15000);
      log('Welcome screen found — login succeeded.');

       await driver.sleep(5000);
       
      log('Logging out...');
      const logoutEl = await driver.findElement(SELECTORS.logoutButton);
      await logoutEl.click();

      return 'Login succeeded — welcome screen detected, logged out.';
    } finally {
      log('Closing browser in 5 seconds...');
      await driver.sleep(5000);
      await driver.quit();
    }
  },
};