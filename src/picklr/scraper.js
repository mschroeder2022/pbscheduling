// READ-ONLY Picklr reservation scraper. Opens the reservations page (via the
// read-only browser guard), parses it, and returns structured reservations.
// NEVER books or modifies anything — see src/picklr/browser.js safety notes.
const log = require('../logger');
const { openReservations } = require('./browser');
const { parseReservations } = require('./parse');
const { picklr } = require('../config');

// Check one location. Returns { location, ok, reservations, error }.
async function checkLocation(loc, nowMs = Date.now()) {
  let context;
  try {
    log.info(`[picklr:${loc}] opening reservations (read-only)`);
    const session = await openReservations(loc);
    context = session.context;
    const innerText = await session.page.evaluate(() => document.body.innerText);
    const reservations = parseReservations(innerText, nowMs);
    log.info(`[picklr:${loc}] read ${reservations.length} reservation(s)`);
    return { location: loc, ok: true, reservations };
  } catch (err) {
    log.error(`[picklr:${loc}] check failed: ${err.message || err}`);
    return { location: loc, ok: false, reservations: [], error: String(err.message || err) };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

// Check every configured location (sequentially — headed Chrome, one window at a time).
async function checkAll(nowMs = Date.now()) {
  const results = {};
  for (const loc of picklr.locations) {
    results[loc] = await checkLocation(loc, nowMs);
  }
  return results;
}

module.exports = { checkLocation, checkAll };
