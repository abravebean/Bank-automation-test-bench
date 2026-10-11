// Shared Playwright browser launcher for the dashboard tests,
// the Playwright counterpart to lib/driver.js.
const { chromium } = require('playwright');

const HEADLESS = process.env.HEADLESS !== 'false'; // default true

async function launchPage() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    // In Docker we point Playwright at the system Chromium, same as Selenium.
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  return { browser, page };
}

module.exports = { launchPage, HEADLESS };
