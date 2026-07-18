// Identify which Cloudflare mitigation is on the login POST.
// Signals:
//   - Response header `cf-mitigated: challenge`  => Managed Challenge / interactive
//   - `/cdn-cgi/challenge-platform/` scripts      => Managed Challenge or JS Challenge
//   - challenges.cloudflare.com/turnstile + explicit sitekey in page  => site-embedded Turnstile
//   - Bot Fight Mode  => usually a bare JS challenge, no checkbox, header cf-mitigated + 403 with no turnstile sitekey
// We load the sign-in page, submit creds, and record everything about the resulting interstitial.
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
const EMAIL = process.env[`PICKLR_${name.toUpperCase()}_EMAIL`] || process.env.PICKLR_EMAIL;
const PASSWORD = process.env[`PICKLR_${name.toUpperCase()}_PASSWORD`] || process.env.PICKLR_PASSWORD;
const SIGNIN = `https://${name}.thepicklr.com/users/sign_in`;
const OUT_DIR = path.join(__dirname, '..', 'recon-out');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const netlog = [];
  const cfHeaders = {};
  page.on('response', async (resp) => {
    const url = resp.url();
    if (/challenges\.cloudflare\.com|cdn-cgi\/challenge-platform|turnstile|cf_chl|\/users\/sign_in/.test(url)) {
      const h = resp.headers();
      netlog.push({ url: url.slice(0, 140), status: resp.status(),
        cfMitigated: h['cf-mitigated'], server: h['server'], cfRay: h['cf-ray'],
        contentType: h['content-type'] });
    }
    if (/thepicklr\.com\/users\/sign_in/.test(url)) {
      const h = resp.headers();
      Object.assign(cfHeaders, { status: resp.status(), cfMitigated: h['cf-mitigated'],
        server: h['server'], cfRay: h['cf-ray'], setCookiePresent: !!h['set-cookie'] });
    }
  });

  const report = { location: name };
  await page.goto(SIGNIN, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);

  // Submit credentials
  if (await page.$('#user_email')) {
    await page.fill('#user_email', EMAIL);
    await page.fill('#user_password', PASSWORD);
    await page.check('#user_remember_me').catch(() => {});
    await page.click('input[type="submit"][name="commit"]').catch(() => {});
  }
  await page.waitForTimeout(8000); // let the interstitial render

  report.postLoginUrl = page.url();
  report.title = await page.title().catch(() => '');
  report.signInResponseHeaders = cfHeaders;

  // What challenge scripts / iframes are present?
  report.iframes = page.frames().map(f => f.url()).filter(u => u && u !== 'about:blank');
  report.scripts = await page.$$eval('script[src]', els => els.map(e => e.src)
    .filter(s => /challenge|turnstile|cloudflare|cf_chl|jsd/.test(s))).catch(() => []);
  // Explicit Turnstile widget with a sitekey => the SITE embedded Turnstile (solvable via sitekey).
  // No sitekey but cf challenge-platform => Managed Challenge (Cloudflare-injected).
  report.turnstileWidgets = await page.$$eval('.cf-turnstile, [data-sitekey], div[id^="cf-chl"]',
    els => els.map(e => ({ cls: e.className, sitekey: e.getAttribute('data-sitekey'), id: e.id }))).catch(() => []);
  report.hasCheckbox = !!(await page.$('input[type="checkbox"]').catch(() => null));
  const body = await page.evaluate(() => document.body.innerText).catch(() => '');
  report.bodyText = body.slice(0, 400);
  report.mentionsManaged = /performing security verification|checking your browser|verify you are human/i.test(body);
  report.netlog = netlog;

  // Classification heuristic
  const cfm = (cfHeaders.cfMitigated || '').toLowerCase();
  const hasChallengePlatform = report.iframes.concat(report.scripts).some(u => /cdn-cgi\/challenge-platform|challenges\.cloudflare\.com/.test(u));
  const siteSitekey = report.turnstileWidgets.some(w => w.sitekey);
  if (siteSitekey) report.classification = 'SITE-EMBEDDED TURNSTILE (has data-sitekey) — solvable by rendering/clicking widget';
  else if (cfm === 'challenge' || (hasChallengePlatform && report.hasCheckbox)) report.classification = 'CLOUDFLARE MANAGED CHALLENGE (interactive) — injected by CF, no site sitekey';
  else if (hasChallengePlatform) report.classification = 'CLOUDFLARE JS CHALLENGE / BOT FIGHT MODE (non-interactive JS)';
  else report.classification = 'NO CHALLENGE / already passed';

  fs.writeFileSync(path.join(OUT_DIR, `${name}-cf-diagnosis.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, netlog: `(${netlog.length} entries, see file)`, bodyText: report.bodyText }, null, 2));
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-cf-diagnosis.png`), fullPage: true }).catch(() => {});
  await browser.close();
})();
