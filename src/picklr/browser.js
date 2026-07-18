// Reusable, READ-ONLY Picklr browser session.
//
// SAFETY (hard requirement): this module must only ever READ the reservations page.
// It NEVER books/reserves/cancels. Guarantees:
//   1. It only ever navigates to the /account/reservations URL and reads the DOM.
//      It never clicks Book / Reserve / Schedule / Pay / Leave controls.
//   2. Once login is complete, a network guard ABORTS any non-GET/HEAD request to
//      thepicklr.com and any navigation to booking-ish paths. So even a future bug
//      cannot create or modify a reservation.
//
// Login reuses the step-0 approach (playwright-extra stealth + persistent Chrome
// profile) that passes the Cloudflare Managed Challenge.
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');
const log = require('../logger');
const { STATE_DIR, picklr } = require('../config');

const PROFILE = (loc) => path.join(STATE_DIR, `profile-${loc}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Paths that must never be navigated to, even via GET (defense in depth).
const FORBIDDEN_PATH = /(reserve|reservation[s]?\/new|booking|\/book\b|checkout|payment|schedule\/new|cart)/i;
// The one page we read.
const RES_PATH = /\/account\/reservations/;

function creds(loc) {
  return {
    email: process.env[`PICKLR_${loc.toUpperCase()}_EMAIL`] || picklr.email,
    password: process.env[`PICKLR_${loc.toUpperCase()}_PASSWORD`] || picklr.password,
  };
}

async function isChallenge(page) {
  const t = await page.title().catch(() => '');
  return /just a moment|attention required/i.test(t);
}

async function humanClick(page, x, y) {
  let cx = 5, cy = 5;
  for (let i = 1; i <= 18; i++) {
    cx += (x - cx) * (i / 18); cy += (y - cy) * (i / 18);
    await page.mouse.move(cx + (i % 3), cy + (i % 2), { steps: 2 });
    await sleep(40 + (i % 5) * 15);
  }
  await page.mouse.move(x, y, { steps: 4 });
  await sleep(150); await page.mouse.down(); await sleep(70); await page.mouse.up();
}

async function solveChallenge(page) {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (!(await isChallenge(page))) return true;
    const handle = await page.$('iframe[src*="challenges.cloudflare.com"]').catch(() => null);
    if (handle) {
      const box = await handle.boundingBox().catch(() => null);
      if (box && box.width > 0) { await humanClick(page, box.x + 30, box.y + box.height / 2); await sleep(4000); }
      else await sleep(2500);
    } else await sleep(2500);
  }
  return !(await isChallenge(page));
}

// Open a logged-in, read-only session on the reservations page for one location.
// Returns { browser: context, page }. Caller MUST call context.close() when done.
async function openReservations(loc) {
  const { email, password } = creds(loc);
  if (!email || !password) throw new Error(`No Picklr credentials for ${loc}`);
  const signin = `https://${loc}.thepicklr.com/users/sign_in`;
  const resUrl = `https://${loc}.thepicklr.com/account/reservations`;

  fs.mkdirSync(PROFILE(loc), { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE(loc), {
    headless: false, channel: 'chrome', viewport: null,
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized', '--no-first-run'],
  });

  // ---- READ-ONLY NETWORK GUARD ----
  let armed = false; // becomes true after login; before that we must allow the sign-in POST
  await context.route('**/*', (route) => {
    try {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      if (armed && /thepicklr\.com/i.test(url)) {
        let pathname = '';
        try { pathname = new URL(url).pathname; } catch { pathname = url; }
        if (method !== 'GET' && method !== 'HEAD') {
          log.warn(`[picklr:${loc}] BLOCKED ${method} ${pathname} (read-only guard)`);
          return route.abort();
        }
        if (req.isNavigationRequest() && FORBIDDEN_PATH.test(pathname) && !RES_PATH.test(pathname)) {
          log.warn(`[picklr:${loc}] BLOCKED navigation to ${pathname} (read-only guard)`);
          return route.abort();
        }
      }
    } catch { /* fall through to continue */ }
    return route.continue();
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(resUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  if (await isChallenge(page)) await solveChallenge(page);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // If a cached session is still valid we land on reservations; otherwise log in.
  if (/users\/sign_in/.test(page.url())) {
    await page.waitForSelector('#user_email', { timeout: 20000 });
    await page.fill('#user_email', email);
    await page.fill('#user_password', password);
    await page.check('#user_remember_me').catch(() => {});
    await sleep(400);
    await page.click('input[type="submit"][name="commit"]'); // the ONLY submit we ever do (login)
    await sleep(3500);
    if (await isChallenge(page)) await solveChallenge(page);
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    if (!/account\/reservations/.test(page.url())) {
      await page.goto(resUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      if (await isChallenge(page)) await solveChallenge(page);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }
  }

  armed = true; // lock down: no mutating requests or booking navigations from here on
  if (!/account\/reservations/.test(page.url())) {
    throw new Error(`Could not reach reservations page for ${loc} (at ${page.url()})`);
  }
  return { context, page };
}

module.exports = { openReservations };
