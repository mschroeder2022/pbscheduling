// Step 0, attempt 3: the login POST triggers an INTERACTIVE Cloudflare Turnstile
// ("Verify you are human" checkbox). Try to click it, then see whether login
// completes (proving no MFA) or an MFA prompt appears.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

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

async function clearTurnstile(page, tag) {
  // Wait for the interstitial to appear or the page to already be clear
  for (let attempt = 0; attempt < 8; attempt++) {
    const title = await page.title().catch(() => '');
    if (!/just a moment/i.test(title)) return true;

    // The Turnstile widget is an iframe; try clicking the "Verify you are human" checkbox.
    const frame = page.frames().find(f => /challenges\.cloudflare\.com/.test(f.url()));
    if (frame) {
      const box = await frame.$('input[type="checkbox"], .cb-lb, label').catch(() => null);
      if (box) { await box.click({ timeout: 5000 }).catch(() => {}); }
    } else {
      // Fallback: click the checkbox region by coordinates relative to the widget container
      const widget = await page.$('div:has-text("Verify you are human")').catch(() => null);
      if (widget) {
        const bb = await widget.boundingBox().catch(() => null);
        if (bb) await page.mouse.click(bb.x + 30, bb.y + bb.height / 2).catch(() => {});
      }
    }
    await page.waitForTimeout(4000);
  }
  return !/just a moment/i.test(await page.title().catch(() => ''));
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });

  for (const loc of LOCATIONS) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const result = { name: loc.name };
    try {
      await page.goto(loc.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await clearTurnstile(page, 'initial');
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      if (/users\/sign_in/.test(page.url())) {
        await page.fill('#user_email', loc.email);
        await page.fill('#user_password', loc.password);
        await page.check('#user_remember_me').catch(() => {});
        await page.click('input[type="submit"][name="commit"]');
        await page.waitForTimeout(3000);
        await clearTurnstile(page, 'postlogin');
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        if (!/users\/sign_in/.test(page.url()) && !/account\/reservations/.test(page.url())) {
          await page.goto(loc.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
          await clearTurnstile(page, 'reservations');
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        }
      }

      result.postLoginUrl = page.url();
      result.title = await page.title();
      const body = await page.evaluate(() => document.body.innerText);
      result.mfaIndicators = (body.match(/\b(2fa|mfa|two[- ]factor|verification code|one[- ]time|enter the code|code sent|authenticator)\b/gi) || []);
      result.codeInputs = await page.$$eval('input', els => els
        .filter(e => /code|otp|token/i.test(e.name + e.id + e.placeholder) && e.type !== 'hidden')
        .map(e => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder })));
      result.stillOnLoginPage = /users\/sign_in/.test(page.url());
      result.reachedReservations = /account\/reservations/.test(page.url());
      result.stuckOnChallenge = /just a moment/i.test(result.title);
      result.invalidCredentials = /invalid email or password/i.test(body);
      result.bodySnippet = body.slice(0, 1000);

      await page.screenshot({ path: path.join(OUT_DIR, `${loc.name}-postlogin2.png`), fullPage: true });
      if (result.reachedReservations) {
        await ctx.storageState({ path: path.join(STATE_DIR, `${loc.name}.json`) });
        result.sessionSaved = true;
      }

      if (result.reachedReservations) result.verdict = 'LOGIN OK — NO MFA';
      else if (result.mfaIndicators.length || result.codeInputs.length) result.verdict = 'MFA PROMPT DETECTED';
      else if (result.invalidCredentials) result.verdict = 'BAD CREDENTIALS';
      else if (result.stuckOnChallenge) result.verdict = 'BLOCKED BY CLOUDFLARE (interactive challenge not cleared)';
      else result.verdict = 'UNCLEAR — inspect screenshot';
    } catch (err) {
      result.error = String(err);
      result.verdict = 'ERROR';
    }
    fs.writeFileSync(path.join(OUT_DIR, `${loc.name}-login-test2.json`), JSON.stringify(result, null, 2));
    console.log(`--- ${loc.name}: ${result.verdict} ---`);
    console.log(JSON.stringify({ ...result, bodySnippet: undefined }, null, 2));
    await ctx.close();
  }

  await browser.close();
})();
