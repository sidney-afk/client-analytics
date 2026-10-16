// Preserve the existing gate's assertions/timings; use visible Chrome and
// foreground its screenshots. Credentials remain environment inputs only.
const path = require('node:path');
const pw = require('playwright');
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (options = {}) => {
  const browser = await launch({ ...options, headless: false, channel: 'chrome',
    executablePath: undefined, args: [...(options.args || []), '--window-size=1450,1000'] });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options = {}) => {
    const context = await newContext(options);
    const newPage = context.newPage.bind(context);
    context.newPage = async () => {
      const page = await newPage();
      const screenshot = page.screenshot.bind(page);
      page.screenshot = async (options = {}) => { await page.bringToFront(); return screenshot(options); };
      return page;
    };
    return context;
  };
  return browser;
};
const gate = process.argv[2];
if (!gate) throw new Error('Pass the existing gate path.');
process.argv.splice(2, 1);
console.log('VISIBLE_CHROME: existing gate assertions and timing unchanged; headless=false; screenshots foregrounded.');
require(path.resolve(gate));
