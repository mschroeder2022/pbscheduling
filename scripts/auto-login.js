// Automated Picklr login that solves the Cloudflare MANAGED CHALLENGE
// (cf-mitigated: challenge, Turnstile widget) without human help.
//
// Strategy:
//  1. playwright-extra + stealth to strip navigator.webdriver and common leaks.
//  2. Persistent real-Chrome profile (challenge is friendlier to a warm profile).
//  3. When the interstitial appears, locate the Turnstile iframe and click the
//     checkbox with a TRUSTED OS-level mouse event (page.mouse), with human-like
//     movement — a JS .click() on the element does not satisfy Turnstile.
//  4. Detect success (reach /account/reservations) vs. an MFA prompt afterward.
//
// Usage: node scripts/auto-login.js [scottsdalenorth|tempe|mesa]
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const name = (process.argv[2] || 'scottsdalenorth').toLowerCase();
const EMAIL = process.env[`PICKLR_${name.toUpperCase()}_EMAIL`] || process.env.PICKLR_EMAIL;
const PASSWORD = process.env[`PICKLR_${name.toUpperCase()}_PASSWORD`] || process.env.PICKLR_PASSWORD;
const SIGNIN = `https://${name}.thepicklr.com/users/sign_in`;
const RES_URL = `https://${name}.thepicklr.com/account/reservations`;
const OUT_DIR = path.join(__dirname, '..', 'recon-out');
const STATE_DIR = path.join(__dirname, '..', '.state');
const PROFILE_DIR = path.join(STATE_DIR, `profile-${name}`);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function isChallenge(page) {
  const t = await page.title().catch(() => '');
  return /just a moment|attention required/i.test(t);
}

// Move the mouse in small human-like increments toward a target, then click.
async function humanClick(page, x, y) {
  const steps = 18;
  let cx = 5, cy = 5;
  for (let i = 1; i <= steps; i++) {
    cx = cx + (x - cx) * (i / steps);
    cy = cy + (y - cy) * (i / steps);
    await page.mouse.move(cx + (i % 3), cy + (i % 2), { steps: 2 });
    await sleep(40 + (i % 5) * 15);
  }
  await page.mouse.move(x, y, { steps: 4 });
  await sleep(180);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}

// Try to solve the Turnstile managed challenge by clicking the checkbox region
// inside the challenges.cloudflare.com iframe.
async function solveChallenge(page, log) {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (!(await isChallenge(page))) return true;

    // The Turnstile widget renders inside an iframe on challenges.cloudflare.com.
    const handle = await page.$('iframe[src*="challenges.cloudflare.com"]').catch(() => null);
    if (handle) {
      const box = await handle.boundingBox().catch(() => null);
      if (box && box.width > 0) {
        // Checkbox sits ~30px from the left edge, vertically centered in the widget.
        const x = box.x + 30;
        const y = box.y + box.height / 2;
        log(`attempt ${attempt}: clicking Turnstile checkbox at (${Math.round(x)}, ${Math.round(y)})`);
        await humanClick(page, x, y);
        await sleep(4000);
        // Some managed challenges reload the page after solving.
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      } else {
        log(`attempt ${attempt}: turnstile iframe present but not yet laid out`);
        await sleep(2500);
      }
    } else {
      log(`attempt ${attempt}: no turnstile iframe yet, waiting`);
      await sleep(2500);
    }
    await sleep(1500);
  }
  return !(await isChallenge(page));
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const log = (m) => console.log(`[${name}] ${m}`);

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    viewport: null,
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized', '--no-first-run'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const result = { name };

  try {
    log('loading sign-in page');
    await page.goto(SIGNIN, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    if (await isChallenge(page)) { log('challenge on initial load'); await solveChallenge(page, log); }
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // If a saved session already logged us in, we may land straight on reservations.
    if (/account\/reservations/.test(page.url())) {
      result.verdict = 'ALREADY LOGGED IN (cached session) — NO MFA';
    } else {
      log('filling credentials');
      await page.waitForSelector('#user_email', { timeout: 20000 });
      await page.fill('#user_email', EMAIL);
      await page.fill('#user_password', PASSWORD);
      await page.check('#user_remember_me').catch(() => {});
      await sleep(500);
      await page.click('input[type="submit"][name="commit"]');
      log('submitted login, waiting for result');
      await sleep(4000);

      // The POST typically triggers the managed challenge.
      if (await isChallenge(page)) {
        log('managed challenge after login — attempting solve');
        await solveChallenge(page, log);
      }
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

      // If we cleared the challenge but didn't auto-redirect, load reservations.
      if (!/account\/reservations/.test(page.url()) && !/users\/sign_in/.test(page.url()) && !(await isChallenge(page))) {
        await page.goto(RES_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        if (await isChallenge(page)) await solveChallenge(page, log);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      }

      const url = page.url();
      const body = await page.evaluate(() => document.body.innerText).catch(() => '');
      const mfa = (body.match(/\b(2fa|mfa|two[- ]factor|verification code|one[- ]time|enter the code|code sent|authenticator)\b/gi) || []);
      result.mfaIndicators = [...new Set(mfa.map(s => s.toLowerCase()))];
      result.finalUrl = url;
      result.stuckOnChallenge = await isChallenge(page);
      result.invalidCredentials = /invalid email or password/i.test(body);

      if (/account\/reservations/.test(url)) result.verdict = 'LOGIN OK — NO MFA';
      else if (result.mfaIndicators.length) result.verdict = 'MFA PROMPT DETECTED';
      else if (result.invalidCredentials) result.verdict = 'BAD CREDENTIALS';
      else if (result.stuckOnChallenge) result.verdict = 'STILL BLOCKED BY MANAGED CHALLENGE';
      else result.verdict = 'UNCLEAR — inspect screenshot';
    }

    await page.screenshot({ path: path.join(OUT_DIR, `${name}-auto-login.png`), fullPage: true }).catch(() => {});
    if (/account\/reservations/.test(page.url())) {
      await ctx.storageState({ path: path.join(STATE_DIR, `${name}.json`) });
      result.sessionSaved = true;
    }
  } catch (err) {
    result.error = String(err);
    result.verdict = result.verdict || 'ERROR';
  }

  fs.writeFileSync(path.join(OUT_DIR, `${name}-auto-login.json`), JSON.stringify(result, null, 2));
  console.log(`\n=== ${name}: ${result.verdict} ===`);
  console.log(JSON.stringify(result, null, 2));
  await ctx.close();
})();
