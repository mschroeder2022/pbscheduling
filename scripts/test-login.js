// Step 0: real login attempt per location to verify whether MFA is present.
// Requires .env with PICKLR_EMAIL / PICKLR_PASSWORD (or per-location overrides).
// Uses headed real Chrome (Cloudflare blocks headless). On success, saves the
// session storage state to .state/<location>.json for reuse by the scraper.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Minimal .env loader (no dotenv dependency needed yet)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const LOCATIONS = ['scottsdalenorth', 'tempe', 'mesa'].map(name => ({
  name,
  url: `https://${name}.thepicklr.com/account/reservations`,
  email: process.env[`PICKLR_${name.toUpperCase()}_EMAIL`] || process.env.PICKLR_EMAIL,
  password: process.env[`PICKLR_${name.toUpperCase()}_PASSWORD`] || process.env.PICKLR_PASSWORD,
}));

const OUT_DIR = path.join(__dirname, '..', 'recon-out');
const STATE_DIR = path.join(__dirname, '..', '.state');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const missing = LOCATIONS.filter(l => !l.email || !l.password).map(l => l.name);
  if (missing.length) {
    console.error(`Missing credentials for: ${missing.join(', ')}. Fill in .env (see .env.example).`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false, channel: 'chrome' });

  for (const loc of LOCATIONS) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const result = { name: loc.name };
    try {
      await page.goto(loc.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => !/just a moment/i.test(document.title), null, { timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      if (/users\/sign_in/.test(page.url())) {
        // Devise player-login form
        await page.fill('#user_email', loc.email);
        await page.fill('#user_password', loc.password);
        await page.check('#user_remember_me').catch(() => {});
        await Promise.all([
          page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}),
          page.click('input[type="submit"][name="commit"]'),
        ]);
        // Cloudflare can challenge the login POST too — wait for it to clear
        await page.waitForFunction(() => !/just a moment/i.test(document.title), null, { timeout: 90000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);
        // If login succeeded but we landed somewhere else, go to reservations to confirm the session
        if (!/users\/sign_in/.test(page.url()) && !/account\/reservations/.test(page.url())) {
          await page.goto(loc.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
          await page.waitForFunction(() => !/just a moment/i.test(document.title), null, { timeout: 60000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        }
      }

      result.postLoginUrl = page.url();
      result.title = await page.title();
      const body = await page.evaluate(() => document.body.innerText);
      result.mfaIndicators = (body.match(/\b(2fa|mfa|two[- ]factor|verification code|one[- ]time|enter the code|code sent)\b/gi) || []);
      result.codeInputs = await page.$$eval('input', els => els
        .filter(e => /code|otp|token/i.test(e.name + e.id + e.placeholder) && e.type !== 'hidden')
        .map(e => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder })));
      result.stillOnLoginPage = /users\/sign_in/.test(page.url());
      result.reachedReservations = /account\/reservations/.test(page.url());
      result.invalidCredentials = /invalid email or password/i.test(body);
      result.bodySnippet = body.slice(0, 1000);

      await page.screenshot({ path: path.join(OUT_DIR, `${loc.name}-postlogin.png`), fullPage: true });
      if (result.reachedReservations) {
        await ctx.storageState({ path: path.join(STATE_DIR, `${loc.name}.json`) });
        result.sessionSaved = true;
      }

      if (result.reachedReservations) result.verdict = 'LOGIN OK — NO MFA';
      else if (result.mfaIndicators.length || result.codeInputs.length) result.verdict = 'MFA PROMPT DETECTED';
      else if (result.invalidCredentials) result.verdict = 'BAD CREDENTIALS';
      else result.verdict = 'UNCLEAR — inspect screenshot';
    } catch (err) {
      result.error = String(err);
      result.verdict = 'ERROR';
    }
    fs.writeFileSync(path.join(OUT_DIR, `${loc.name}-login-test.json`), JSON.stringify(result, null, 2));
    console.log(`--- ${loc.name}: ${result.verdict} ---`);
    console.log(JSON.stringify(result, null, 2));
    await ctx.close();
  }

  await browser.close();
})();
