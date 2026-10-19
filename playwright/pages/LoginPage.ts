// Page Object Model for the demo bank login page.
// Every Playwright test (both the Playwright Test suite and the dashboard
// tests) talks to the page through this class, so a UI change is fixed here once.
import type { Locator, Page } from '@playwright/test';

export class LoginPage {
  readonly usernameField: Locator;
  readonly passwordField: Locator;
  readonly submitButton: Locator;
  readonly mfaIndicator: Locator;
  readonly welcomeHeading: Locator;
  readonly errorMessage: Locator;
  readonly logoutButton: Locator;

  constructor(readonly page: Page) {
    this.usernameField = page.getByTestId('input-username');
    this.passwordField = page.getByTestId('input-password');
    this.submitButton = page.getByText('Login', { exact: true });
    this.mfaIndicator = page.getByTestId('mfa-challenge');
    this.welcomeHeading = page.locator('h1', { hasText: 'Welcome back' });
    this.errorMessage = page.getByTestId('alert-error');
    this.logoutButton = page.getByTestId('btn-logout');
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url);
  }

  async login(username: string, password: string): Promise<void> {
    await this.usernameField.fill(username);
    await this.passwordField.fill(password);
    await this.submitButton.click();
  }

  async logout(): Promise<void> {
    await this.logoutButton.click();
  }
}
