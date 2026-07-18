// Step 0 recon: visit each Picklr location's reservations page (unauthenticated),
// capture where it redirects for login and what the login form looks like
// (fields, SSO buttons, any MFA indicators visible pre-auth).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LOCATIONS = [
  { name: 'scottsdalenorth', url: 'https://scottsdalenorth.thepicklr.com/account/reservations' },
  { name: 'tempe', url: 'https://tempe.thepicklr.com/account/reservations' },
  { name: 'mesa', url: 'https://mesa.thepicklr.com/account/reservations' },
];

const OUT_DIR = path.join(__dirname, '..', 'recon-out');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  for (const loc of LOCATIONS) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const result = { name: loc.name, requestedUrl: loc.url };
    try {
      const resp = await page.goto(loc.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      result.finalUrl = page.url();
      result.status = resp ? resp.status() : null;
      result.title = await page.title();

      // Collect form inputs
      result.inputs = await page.$$eval('input', els => els.map(e => ({
        type: e.type, name: e.name, id: e.id, placeholder: e.placeholder,
        autocomplete: e.autocomplete,
      })));
      // Collect buttons/links that look auth-related
      result.buttons = await page.$$eval('button, a[href*="login"], a[href*="sign"], input[type="submit"]',
        els => els.map(e => (e.innerText || e.value || '').trim()).filter(t => t).slice(0, 30));
      // Any text mentioning 2FA/MFA/verification code
      const body = await page.evaluate(() => document.body.innerText);
      result.mfaMentions = (body.match(/\b(2fa|mfa|two[- ]factor|verification code|one[- ]time)\b/gi) || []);
      result.bodySnippet = body.slice(0, 600);

      await page.screenshot({ path: path.join(OUT_DIR, `${loc.name}.png`), fullPage: false });
    } catch (err) {
      result.error = String(err);
    }
    fs.writeFileSync(path.join(OUT_DIR, `${loc.name}.json`), JSON.stringify(result, null, 2));
    console.log(`--- ${loc.name} ---`);
    console.log(JSON.stringify(result, null, 2));
    await ctx.close();
  }

  await browser.close();
})();
