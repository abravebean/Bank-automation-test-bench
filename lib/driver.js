const { Builder } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const HEADLESS = process.env.HEADLESS !== 'false'; // default true

async function buildDriver() {
  const options = new chrome.Options();

  options.setUserPreferences({
    credentials_enable_service: false,
    'profile.password_manager_enabled': false,
    'profile.password_manager_leak_detection': false,
  });
  options.addArguments(
    '--disable-features=PasswordManagerOnboarding,AutofillServerCommunication,PasswordLeakDetection'
  );

  if (HEADLESS) {
    options.addArguments(
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--window-size=1024,768',
      '--disable-extensions',
      '--mute-audio'
    );
  } else {
    options.addArguments('--window-size=1280,900');
  }

  if (process.env.CHROME_BIN) {
    options.setChromeBinaryPath(process.env.CHROME_BIN);
  }

  return new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();
}

module.exports = { buildDriver, HEADLESS };