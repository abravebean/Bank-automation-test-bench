// Fixtures shared by the BDD step definitions: Page Objects plus a per-scenario
// context for values one step creates and a later step needs (like a test name).
import { test as base, createBdd } from 'playwright-bdd';
import { LoginPage } from '../../playwright/pages/LoginPage';
import { RecorderPage } from '../../playwright/pages/RecorderPage';

interface ScenarioContext {
  /** The unique name actually used for a recording in this scenario. */
  recordingName?: string;
}

export const test = base.extend<{ loginPage: LoginPage; recorderPage: RecorderPage; ctx: ScenarioContext }>({
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  recorderPage: async ({ page }, use) => use(new RecorderPage(page)),
  ctx: async ({}, use) => use({}),
});

export const { Given, When, Then } = createBdd(test);
