// UI tests for the demo bank login, run on Chromium, Firefox and WebKit.
// Each test is tagged with the requirement it proves (compliance/requirements.json)
// and attaches screenshot evidence for the compliance report.
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { captureEvidence, env } from '../support/evidence';

const BANK_URL = env('BANK_URL');
const BANK_USERNAME = env('BANK_USERNAME');
const BANK_PASSWORD = env('BANK_PASSWORD');

test.describe('Login', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!BANK_URL, 'BANK_URL is not set');
    await new LoginPage(page).goto(BANK_URL!);
  });

  test('valid credentials reach the welcome screen and can log out', { tag: '@R1' }, async ({ page }, testInfo) => {
    test.skip(!BANK_USERNAME || !BANK_PASSWORD, 'BANK_USERNAME / BANK_PASSWORD not set');
    const loginPage = new LoginPage(page);

    await test.step('Sign in with valid credentials', async () => {
      await loginPage.login(BANK_USERNAME!, BANK_PASSWORD!);
      await expect(loginPage.welcomeHeading).toBeVisible({ timeout: 15_000 });
      await captureEvidence(page, testInfo, 'Welcome screen after sign-in');
    });

    await test.step('Sign out and return to the login form', async () => {
      await loginPage.logout();
      await expect(loginPage.usernameField).toBeVisible();
      await captureEvidence(page, testInfo, 'Login form after sign-out');
    });
  });

  test('invalid credentials show an error and stay on the login page', { tag: '@R2' }, async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step('Submit a fake username and wrong password', async () => {
      await loginPage.login('not-a-real-user', 'definitely-wrong-password');
    });

    await test.step('An error is shown and no session starts', async () => {
      await expect(loginPage.errorMessage).toBeVisible();
      await expect(loginPage.errorMessage).not.toBeEmpty();
      await expect(loginPage.welcomeHeading).toBeHidden();
      await captureEvidence(page, testInfo, 'Error shown for invalid credentials');
    });
  });

  test('password field masks its input', { tag: '@R3' }, async ({ page }, testInfo) => {
    const loginPage = new LoginPage(page);

    await test.step('Type into the password field', async () => {
      await loginPage.passwordField.fill('visible-if-not-masked');
    });

    await test.step('The field is type="password"', async () => {
      await expect(loginPage.passwordField).toHaveAttribute('type', 'password');
      await captureEvidence(page, testInfo, 'Password field with masked input');
    });
  });
});
