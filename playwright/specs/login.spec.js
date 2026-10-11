const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../pages/LoginPage');

const { BANK_URL, BANK_USERNAME, BANK_PASSWORD } = process.env;

test.describe('Login', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!BANK_URL, 'BANK_URL is not set');
    await new LoginPage(page).goto(BANK_URL);
  });

  test('valid credentials reach the welcome screen and can log out', async ({ page }) => {
    test.skip(!BANK_USERNAME || !BANK_PASSWORD, 'BANK_USERNAME / BANK_PASSWORD not set');
    const loginPage = new LoginPage(page);

    await loginPage.login(BANK_USERNAME, BANK_PASSWORD);
    await expect(loginPage.welcomeHeading).toBeVisible({ timeout: 15_000 });

    await loginPage.logout();
    await expect(loginPage.usernameField).toBeVisible();
  });

  test('invalid credentials show an error and stay on the login page', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.login('not-a-real-user', 'definitely-wrong-password');

    await expect(loginPage.errorMessage).toBeVisible();
    await expect(loginPage.errorMessage).not.toBeEmpty();
    await expect(loginPage.welcomeHeading).toBeHidden();
  });

  test('password field masks its input', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await expect(loginPage.passwordField).toHaveAttribute('type', 'password');
  });
});
