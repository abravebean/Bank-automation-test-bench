// Turns Playwright code into plain-English steps for the Recorder UI.
//   await page.getByTestId('input-username').fill('demo')  ->  Fill "input-username" with "demo"

function unquote(s) {
  return s.replace(/^'(.*)'$/s, '$1').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

const STR = "'(?:[^'\\\\]|\\\\.)*'";

/** Describe a Playwright locator expression in words. */
function describeLocator(expr) {
  let m;
  if ((m = expr.match(new RegExp(`getByRole\\('(\\w+)'(?:,\\s*\\{[^}]*name:\\s*(${STR})[^}]*\\})?\\)`)))) {
    return m[2] ? `${m[1]} "${unquote(m[2])}"` : `${m[1]}`;
  }
  if ((m = expr.match(new RegExp(`getByTestId\\((${STR})\\)`)))) return `"${unquote(m[1])}"`;
  if ((m = expr.match(new RegExp(`getByLabel\\((${STR})`)))) return `field labeled "${unquote(m[1])}"`;
  if ((m = expr.match(new RegExp(`getByPlaceholder\\((${STR})`)))) return `field "${unquote(m[1])}"`;
  if ((m = expr.match(new RegExp(`getByText\\((${STR})`)))) return `text "${unquote(m[1])}"`;
  if ((m = expr.match(new RegExp(`locator\\((${STR})`)))) return `element ${unquote(m[1])}`;
  return 'element';
}

function describeValue(v) {
  const env = v.match(/^process\.env\.(\w+)$/);
  if (env) return `$${env[1]}`;
  return `"${unquote(v)}"`;
}

const ASSERTIONS = {
  toBeVisible: () => 'is visible',
  toBeHidden: () => 'is hidden',
  toContainText: (v) => `contains ${v}`,
  toHaveText: (v) => `has text ${v}`,
  toHaveValue: (v) => `has value ${v}`,
  toBeChecked: () => 'is checked',
  toHaveURL: (v) => `URL is ${v}`,
};

/**
 * @param {string} code
 * @returns {{ line: number, kind: 'navigate'|'action'|'assert', text: string }[]}
 */
function parseSteps(code) {
  const steps = [];
  code.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    let m;

    if ((m = line.match(/^await page\.goto\((.+)\);$/))) {
      steps.push({ line: i + 1, kind: 'navigate', text: `Open ${describeValue(m[1])}` });
      return;
    }

    if ((m = line.match(/^await expect\((.+?)\)\.(not\.)?(\w+)\((.*)\);$/))) {
      const [, target, not, matcher, arg] = m;
      const what = target === 'page' ? 'Page' : describeLocator(target);
      const fn = ASSERTIONS[matcher];
      const desc = fn ? fn(arg ? describeValue(arg) : '') : matcher;
      steps.push({ line: i + 1, kind: 'assert', text: `Check ${what} ${not ? 'not ' : ''}${desc}` });
      return;
    }

    if ((m = line.match(/^await (page\..+)\.(click|dblclick|fill|press|check|uncheck|selectOption|hover)\((.*)\);$/))) {
      const [, target, action, arg] = m;
      const where = describeLocator(target);
      const text = {
        click: () => `Click ${where}`,
        dblclick: () => `Double-click ${where}`,
        fill: () => `Fill ${where} with ${describeValue(arg)}`,
        press: () => `Press ${describeValue(arg)} in ${where}`,
        check: () => `Check ${where}`,
        uncheck: () => `Uncheck ${where}`,
        selectOption: () => `Select ${describeValue(arg)} in ${where}`,
        hover: () => `Hover over ${where}`,
      }[action]();
      steps.push({ line: i + 1, kind: 'action', text });
    }
  });
  return steps;
}

module.exports = { parseSteps, describeLocator };
