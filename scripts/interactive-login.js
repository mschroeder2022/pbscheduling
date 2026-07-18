// Step 0 (human-assisted): Cloudflare's interactive Turnstile blocks the fully
// automated login POST. This opens a REAL Chrome window with a persistent profile,
// navigates to a location's sign-in page, and pre-fills the credentials. You solve
// the "Verify you are human" checkbox and click Sign In. The script watches the
// result and reports whether login succeeded with NO MFA, or an MFA prompt appeared,
// then saves the session (cookies) for reuse so future scraper runs skip the login.
//
// Usage: node scripts/interactive-login.js [scottsdalenorth|tempe|mesa]
//        (defaults to scottsdalenorth)
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

const name = (process.argv[2] || 'scottsdalenorth').toLowerCase();
const loc = {
  name,
  url: `https://${name}.thepicklr.com/account/reservations`,
  signin: `https://${name}.thepicklr.com/users/sign_in`,
  email: process.env[`PICKLR_${name.toUpperCase()}_EMAIL`] || process.env.PICKLR_EMAIL,
  password: process.env[`PICKLR_${name.toUpperCase()}_PASSWORD`] || process.env.PICKLR_PASSWORD,
};

const OUT_DIR = path.join(__dirname, '..', 'recon-out');
const STATE_DIR = path.join(__dirname, '..', '.state');
const PROFILE_DIR = path.join(STATE_DIR, `profile-${name}`);

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  if (!loc.email || !loc.password) {
    console.error('Missing credentials in .env'); process.exit(1);
  }

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    viewport: null,
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  console.log(`\n=== ${loc.name.toUpperCase()} ===`);
  await page.goto(loc.signin, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

  // Pre-fill the login fields as soon as the form is present, so the human only
  // has to solve the checkbox and click Sign In.
  const prefill = async () => {
    try {
      await page.waitForSelector('#user_email', { timeout: 8000 });
      await page.fill('#user_email', loc.email);
      await page.fill('#user_password', loc.password);
      await page.check('#user_remember_me').catch(() => {});
      console.log('>> Credentials pre-filled. Solve the "Verify you are human" checkbox, then click Sign In.');
    } catch { /* form not present yet (challenge showing) — will retry */ }
  };
  await prefill();
  // Retry prefill a few times in case the challenge delayed the form
  for (let i = 0; i < 5; i++) {
    if (await page.$('#user_email').catch(() => null)) { await prefill(); break; }
    await page.waitForTimeout(3000);
  }

  console.log('>> Waiting up to 5 minutes for you to complete login...');

  // Poll until we reach reservations (success) or detect an MFA prompt.
  let verdict = 'TIMEOUT — login not completed';
  let mfaSeen = [];
  const maxTicks = 100; // 100 * 3s = 300s
  for (let tick = 0; tick < maxTicks; tick++) {
    await page.waitForTimeout(3000);
    const url = page.url();
    if (/account\/reservations/.test(url)) { verdict = 'LOGIN OK — NO MFA'; break; }
    const body = await page.evaluate(() => document.body.innerText).catch(() => '');
    const hits = body.match(/\b(2fa|mfa|two[- ]factor|verification code|one[- ]time|enter the code|code sent|authenticator)\b/gi);
    if (hits && hits.length) {
      mfaSeen = [...new Set(hits.map(h => h.toLowerCase()))];
      // Also confirm we're past the password step (not still on plain sign_in)
      if (!/users\/sign_in\b/.test(url) || /code/i.test(body)) { verdict = 'MFA PROMPT DETECTED'; break; }
    }
    if (/invalid email or password/i.test(body)) { verdict = 'BAD CREDENTIALS'; break; }
  }

  // Make sure we can actually load the reservations page with this session
  if (verdict === 'LOGIN OK — NO MFA') {
    await page.goto(loc.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }

  await page.screenshot({ path: path.join(OUT_DIR, `${loc.name}-interactive.png`), fullPage: true }).catch(() => {});
  await ctx.storageState({ path: path.join(STATE_DIR, `${loc.name}.json`) }).catch(() => {});

  console.log(`\n=== RESULT: ${verdict} ===`);
  if (mfaSeen.length) console.log(`MFA indicators seen: ${mfaSeen.join(', ')}`);
  console.log(`Final URL: ${page.url()}`);
  console.log(`Session saved to .state/${loc.name}.json and profile-${loc.name}/`);
  console.log('Close the browser window (or it will close in 20s).');

  await page.waitForTimeout(20000);
  await ctx.close();
})();
