// Unit tests for the pure trigger logic. No Discord, no calendar — synthetic events
// and clock values so we can prove the windows fire exactly as specified.
const { evaluateEvent, HOUR, DAY } = require('../src/scheduler/triggers');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); }
  else { fail++; console.log(`  FAIL- ${name}`); }
}

// Build a tracked event whose start is `offsetMs` from `now`, at Phoenix local time.
// We express start as a Phoenix-local ISO by converting the target UTC instant to -07:00.
function trackedAt(now, offsetMs, overrides = {}) {
  const startUtc = new Date(now + offsetMs);
  // Convert to Phoenix wall-clock string (UTC-7) without a tz suffix, as Graph returns.
  const phx = new Date(startUtc.getTime() - 7 * HOUR).toISOString().replace('Z', '.0000000');
  return {
    id: 'x', shortId: 'x', title: 't', type: 'rec_game',
    startISO: phx, isPicklrIndoor: false,
    signupStatus: 'unknown', bookingStatus: 'unknown',
    reminderSent: false, weekCheckSent: false, monthCheckSent: false,
    ...overrides,
  };
}

const now = Date.UTC(2026, 6, 20, 12, 0, 0); // fixed clock
const kinds = a => a.map(x => x.kind).sort();

// --- Rec game ---
check('rec: 10 days out => nothing',
  kinds(evaluateEvent(trackedAt(now, 10 * DAY), now)).length === 0);
check('rec: 6 days out => week_check only',
  JSON.stringify(kinds(evaluateEvent(trackedAt(now, 6 * DAY), now))) === JSON.stringify(['week_check']));
check('rec: 90 min out => week_check + reminder',
  JSON.stringify(kinds(evaluateEvent(trackedAt(now, 90 * 60 * 1000), now))) === JSON.stringify(['reminder', 'week_check']));
check('rec: 90 min out but both already sent => nothing',
  kinds(evaluateEvent(trackedAt(now, 90 * 60 * 1000, { weekCheckSent: true, reminderSent: true }), now)).length === 0);
check('rec: already started (=-5min) => nothing',
  kinds(evaluateEvent(trackedAt(now, -5 * 60 * 1000), now)).length === 0);
check('rec: exactly 3 hours out => week_check only (reminder not yet)',
  JSON.stringify(kinds(evaluateEvent(trackedAt(now, 3 * HOUR), now))) === JSON.stringify(['week_check']));

// --- Drill (same rules as rec) ---
check('drill_1v1: 5 days out => week_check',
  JSON.stringify(kinds(evaluateEvent(trackedAt(now, 5 * DAY, { type: 'drill_1v1' }), now))) === JSON.stringify(['week_check']));
check('drill_2v1: 1 hour out => week_check + reminder',
  JSON.stringify(kinds(evaluateEvent(trackedAt(now, 1 * HOUR, { type: 'drill_2v1' }), now))) === JSON.stringify(['reminder', 'week_check']));

// --- Tournament: month check only, NO reminder, NO week check ---
check('tournament: 40 days out => nothing',
  kinds(evaluateEvent(trackedAt(now, 40 * DAY, { type: 'tournament' }), now)).length === 0);
check('tournament: 20 days out => month_check',
  JSON.stringify(kinds(evaluateEvent(trackedAt(now, 20 * DAY, { type: 'tournament' }), now))) === JSON.stringify(['month_check']));
// With the month check already sent, a tournament near its start must NOT produce a
// 2hr reminder or a week check (those triggers don't apply to tournaments at all).
check('tournament: 2 hours out, month check sent => nothing (no 2hr reminder)',
  kinds(evaluateEvent(trackedAt(now, 2 * HOUR, { type: 'tournament', monthCheckSent: true }), now)).length === 0);
check('tournament: 5 days out, month check sent => nothing (no week check)',
  kinds(evaluateEvent(trackedAt(now, 5 * DAY, { type: 'tournament', monthCheckSent: true }), now)).length === 0);
// And before the month check is sent, being within 30 days DOES fire it (even late).
check('tournament: 5 days out, not yet sent => month_check (late but correct)',
  JSON.stringify(kinds(evaluateEvent(trackedAt(now, 5 * DAY, { type: 'tournament' }), now))) === JSON.stringify(['month_check']));
check('tournament: month check already sent => nothing',
  kinds(evaluateEvent(trackedAt(now, 20 * DAY, { type: 'tournament', monthCheckSent: true }), now)).length === 0);

// --- Unknown type: never fires ---
check('unknown: 1 day out => nothing',
  kinds(evaluateEvent(trackedAt(now, 1 * DAY, { type: 'unknown' }), now)).length === 0);

// --- Picklr rec (normalized to rec_game) behaves like rec ---
check('picklr rec: 3 days out => week_check',
  JSON.stringify(kinds(evaluateEvent(trackedAt(now, 3 * DAY, { isPicklrIndoor: true, picklrLocation: 'tempe' }), now))) === JSON.stringify(['week_check']));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
