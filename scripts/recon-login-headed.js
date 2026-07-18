// Step 0 recon, attempt 2: headed real Chrome so Cloudflare's non-interactive
// check can pass. Waits for the challenge to clear, then captures the login
// page structure and saves cookies (storage state) per location for reuse.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LOCATIONS = [
  { name: 'scottsdalenorth', url: 'https://scottsdalenorth.thepicklr.com/account/reservations' },
  { name: 'tempe', url: 'https://tempe.thepicklr.com/account/reservations' },
  { name: 'mesa', url: 'https://mesa.thepicklr.com/account/reservations' },
];

const OUT_DIR = path.join(__dirname, '..', 'recon-out');
const STATE_DIR = path.join(__dirname, '..', '.state');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });

  for (const loc of LOCATIONS) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const result = { name: loc.name, requestedUrl: loc.url };
    try {
      await page.goto(loc.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Wait up to 60s for the Cloudflare interstitial to clear
      const cleared = await page
        .waitForFunction(() => !/just a moment/i.test(document.title), null, { timeout: 60000 })
        .then(() => true)
        .catch(() => false);
      result.challengeCleared = cleared;
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      result.finalUrl = page.url();
      result.title = await page.title();
      result.inputs = await page.$$eval('input', els => els.map(e => ({
        type: e.type, name: e.name, id: e.id, placeholder: e.placeholder,
        autocomplete: e.autocomplete,
      })));
      result.buttons = await page.$$eval('button, a[href*="login"], a[href*="sign"], input[type="submit"]',
        els => els.map(e => (e.innerText || e.value || '').trim()).filter(t => t).slice(0, 30));
      const body = await page.evaluate(() => document.body.innerText);
      result.mfaMentions = (body.match(/\b(2fa|mfa|two[- ]factor|verification code|one[- ]time)\b/gi) || []);
      result.bodySnippet = body.slice(0, 1200);

      await page.screenshot({ path: path.join(OUT_DIR, `${loc.name}-headed.png`) });
      await ctx.storageState({ path: path.join(STATE_DIR, `${loc.name}.json`) });
    } catch (err) {
      result.error = String(err);
    }
    fs.writeFileSync(path.join(OUT_DIR, `${loc.name}-headed.json`), JSON.stringify(result, null, 2));
    console.log(`--- ${loc.name} ---`);
    console.log(JSON.stringify(result, null, 2));
    await ctx.close();
  }

  await browser.close();
})();
