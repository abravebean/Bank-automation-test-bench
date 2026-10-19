import { expect } from '@playwright/test';
import { Given, When, Then } from './fixtures';
import { captureEvidence, env } from '../../playwright/support/evidence';

/** "$BANK_USERNAME" in a feature table means "the value from .env", so no real credentials live in Gherkin. */
function resolve(value: string): string | undefined {
  const match = value.match(/^\$(BANK_URL|BANK_USERNAME|BANK_PASSWORD)$/);
  return match ? env(match[1] as 'BANK_URL' | 'BANK_USERNAME' | 'BANK_PASSWORD') : value;
}

Given('I am on the bank login page', async ({ loginPage, $test }) => {
  const url = env('BANK_URL');
  $test.skip(!url, 'BANK_URL is not set');
  await loginPage.goto(url!);
});

When('I sign in with my valid credentials', async ({ loginPage, $test }) => {
  const username = env('BANK_USERNAME');
  const password = env('BANK_PASSWORD');
  $test.skip(!username || !password, 'BANK_USERNAME / BANK_PASSWORD not set');
  await loginPage.login(username!, password!);
});

When('I sign in as {string} with password {string}', async ({ loginPage, $test }, username: string, password: string) => {
  const user = resolve(username);
  const pass = resolve(password);
  $test.skip(user === undefined || pass === undefined, `${username} is not set`);
  await loginPage.login(user!, pass!);
});

When('I sign out', async ({ loginPage }) => {
  await loginPage.logout();
});

When('I type {string} into the password field', async ({ loginPage }, text: string) => {
  await loginPage.passwordField.fill(text);
});

Then('I see the welcome screen', async ({ loginPage, page, $testInfo }) => {
  await expect(loginPage.welcomeHeading).toBeVisible({ timeout: 15_000 });
  await captureEvidence(page, $testInfo, 'Welcome screen after sign-in');
});

Then('I am back on the login form', async ({ loginPage, page, $testInfo }) => {
  await expect(loginPage.usernameField).toBeVisible();
  await captureEvidence(page, $testInfo, 'Login form after sign-out');
});

Then('I see a sign-in error', async ({ loginPage, page, $testInfo }) => {
  await expect(loginPage.errorMessage).toBeVisible();
  await expect(loginPage.errorMessage).not.toBeEmpty();
  await captureEvidence(page, $testInfo, 'Sign-in error shown');
});

Then('no session is started', async ({ loginPage }) => {
  await expect(loginPage.welcomeHeading).toBeHidden();
  await expect(loginPage.logoutButton).toBeHidden();
});

Then('the password field hides what I typed', async ({ loginPage, page, $testInfo }) => {
  await expect(loginPage.passwordField).toHaveAttribute('type', 'password');
  await captureEvidence(page, $testInfo, 'Password field with masked input');
});
