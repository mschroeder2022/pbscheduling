// Unit tests for orphan-reservation detection (Picklr reservation with no matching
// calendar event). Pure logic — synthetic scans/events and a fixed clock. The dedup
// round-trip test backs up and restores the real alerts file.
const fs = require('fs');
const {
  findOrphanReservations, filterUnalerted, markAlerted, alertFor, getAlert, setAlertStatus,
  orphanShortId, ALERTS_PATH,
} = require('../src/picklr/orphans');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); }
  else { fail++; console.log(`  FAIL- ${name}`); }
}

// Fixed clock: Sun 2026-08-30 12:00 Phoenix (= 19:00 UTC).
const now = Date.UTC(2026, 7, 30, 19, 0, 0);

function res(overrides = {}) {
  return {
    court: 4, dateText: 'Sat, Sep 5', startTime: '16:00', endTime: '17:30',
    status: 'Booked', paid: 'Paid', dateISO: '2026-09-05', ...overrides,
  };
}
function scanOf(...reservations) { return { ok: true, reservations }; }
// Tracked event at a Phoenix wall-clock start (Graph-style ISO, no tz suffix).
function ev(startISO, overrides = {}) {
  return { id: 'x', title: 't', type: 'rec_game', startISO: `${startISO}.0000000`, ...overrides };
}

// --- Basic orphan detection ---
check('booked future reservation, empty calendar => orphan',
  findOrphanReservations({ tempe: scanOf(res()) }, [], now).length === 1);
check('matching event same date/time => covered',
  findOrphanReservations({ tempe: scanOf(res()) }, [ev('2026-09-05T16:00:00')], now).length === 0);
check('event 45 min off (within 60-min tolerance) => covered',
  findOrphanReservations({ tempe: scanOf(res()) }, [ev('2026-09-05T16:45:00')], now).length === 0);
check('event 90 min off => orphan',
  findOrphanReservations({ tempe: scanOf(res()) }, [ev('2026-09-05T17:30:00')], now).length === 1);
check('event on a different date => orphan',
  findOrphanReservations({ tempe: scanOf(res()) }, [ev('2026-09-06T16:00:00')], now).length === 1);
check('non-Picklr event (type unknown, e.g. odd title) still covers',
  findOrphanReservations({ tempe: scanOf(res()) },
    [ev('2026-09-05T16:00:00', { type: 'unknown', isPicklrIndoor: false })], now).length === 0);

// --- Status / time-window filters ---
check('cancelled reservation => not an orphan',
  findOrphanReservations({ tempe: scanOf(res({ status: 'Cancelled' })) }, [], now).length === 0);
check('past reservation => ignored',
  findOrphanReservations({ tempe: scanOf(res({ dateISO: '2026-08-29', dateText: 'Sat, Aug 29' })) }, [], now).length === 0);
check('reservation beyond the sync window (36 days out) => ignored',
  findOrphanReservations({ tempe: scanOf(res({ dateISO: '2026-10-06', dateText: 'Tue, Oct 6' })) }, [], now).length === 0);
check('failed scan location => no orphans (no false alarm)',
  findOrphanReservations({ tempe: { ok: false, reservations: [] } }, [], now).length === 0);

// --- Multi-location + sorting ---
const multi = findOrphanReservations({
  tempe: scanOf(res({ dateISO: '2026-09-06', dateText: 'Sun, Sep 6' })),
  mesa: scanOf(res({ dateISO: '2026-09-02', dateText: 'Wed, Sep 2', court: 8 })),
}, [], now);
check('orphans from multiple locations, sorted soonest-first',
  multi.length === 2 && multi[0].location === 'mesa' && multi[1].location === 'tempe');
check('orphan key includes location/date/time/court',
  multi[0].key === 'mesa|2026-09-02|16:00|c8');

// --- Alert dedup round-trip (backs up and restores the real alerts file) ---
const backup = fs.existsSync(ALERTS_PATH) ? fs.readFileSync(ALERTS_PATH, 'utf8') : null;
try {
  fs.writeFileSync(ALERTS_PATH, '{}');
  const orphans = findOrphanReservations({ tempe: scanOf(res()) }, [], now);
  check('fresh orphan passes filterUnalerted', filterUnalerted(orphans).length === 1);
  markAlerted(orphans, now);
  check('marked orphan is filtered out (alerts once, no daily nag)',
    filterUnalerted(orphans).length === 0);
  const o = orphans[0];
  check('orphan carries a 12-char shortId derived from its key',
    o.shortId === orphanShortId(o.key) && o.shortId.length === 12);
  const rec = alertFor(o);
  check('alert record is pending with reservation details persisted',
    rec && rec.status === 'pending' && rec.shortId === o.shortId
      && rec.reservation && rec.reservation.court === 4 && rec.reservation.dateISO === '2026-09-05');
  check('parser scratch fields (_sh/_sm) are not persisted',
    rec && !('_sh' in rec.reservation) && !('_sm' in rec.reservation));
  check('getAlert(shortId) resolves the record (Discord button lookup)',
    (getAlert(o.shortId) || {}).key === o.key);
  check('getAlert(unknown) => null', getAlert('000000000000') === null);

  // --- Decline: never added, never asked again.
  setAlertStatus(o.shortId, 'ignored', {}, now);
  check('declined orphan => status ignored', (alertFor(o) || {}).status === 'ignored');
  markAlerted(orphans, now);
  check('markAlerted never downgrades ignored back to pending', (alertFor(o) || {}).status === 'ignored');
  check('ignored orphan is not re-alerted', filterUnalerted(orphans).length === 0);

  // --- Approve: records the created event id.
  setAlertStatus(o.shortId, 'added', { eventId: 'AAMk-test' }, now);
  const added = getAlert(o.shortId);
  check('approved orphan => status added with eventId',
    added && added.status === 'added' && added.eventId === 'AAMk-test');
  check('setAlertStatus(unknown) => null', setAlertStatus('000000000000', 'ignored', {}, now) === null);

  // --- Legacy records (written before the approve flow, no status) get re-alerted
  // once WITH buttons instead of silently staying button-less forever.
  fs.writeFileSync(ALERTS_PATH, JSON.stringify({ [o.key]: { alertedAt: 1, startMs: o.startMs } }));
  check('legacy status-less record counts as un-alerted', filterUnalerted(orphans).length === 1);
  markAlerted(orphans, now);
  check('legacy record upgraded to pending on re-alert', (alertFor(o) || {}).status === 'pending');

  // A stale entry (reservation long past) gets pruned on the next save.
  const alerts = JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8'));
  alerts['old|2026-01-01|10:00|c1'] = { alertedAt: 1, startMs: Date.UTC(2026, 0, 1) };
  fs.writeFileSync(ALERTS_PATH, JSON.stringify(alerts));
  markAlerted([], now);
  check('past alert entries are pruned on save',
    !JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8'))['old|2026-01-01|10:00|c1']);
} finally {
  if (backup == null) fs.rmSync(ALERTS_PATH, { force: true });
  else fs.writeFileSync(ALERTS_PATH, backup);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
