// Pure trigger evaluation — no I/O, no Discord — so it can be unit-tested against
// synthetic events and clock values.
//
// Spec (SPEC.md section 1):
//   Tournament          -> no 2hr reminder; 1-MONTH "have you signed up?" check
//   Rec / drill / Picklr -> 2hr-before reminder; 1-WEEK "is the court booked?" check
const { cleanIso } = require('./store');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const REMINDER_MS = 2 * HOUR;   // "2 hrs before"
const WEEK_MS = 7 * DAY;        // "1 week out"
const MONTH_MS = 30 * DAY;      // "1 month out"

// Arizona (America/Phoenix) is MST year-round (UTC-7, no DST). The calendar sync
// requests events in America/Phoenix, so every returned dateTime is Phoenix-local
// and this fixed offset is correct for all of them.
function startInstant(tracked) {
  if (!tracked.startISO) return null;
  const d = new Date(`${cleanIso(tracked.startISO)}-07:00`);
  return isNaN(d.getTime()) ? null : d.getTime();
}

// Returns an array of due actions: { kind: 'reminder'|'week_check'|'month_check',
// flag: <store field to set> }. Only fires inside the window and before the event
// starts, and only when the corresponding flag isn't already set.
function evaluateEvent(tracked, nowMs) {
  const actions = [];
  const start = startInstant(tracked);
  if (start == null) return actions;
  if (nowMs >= start) return actions; // event already started/past — nothing to fire

  const untilStart = start - nowMs;
  const type = tracked.type;

  if (type === 'tournament') {
    if (!tracked.monthCheckSent && untilStart <= MONTH_MS) {
      actions.push({ kind: 'month_check', flag: 'monthCheckSent' });
    }
    return actions; // tournaments get no 2hr reminder and no week check
  }

  // rec_game, drill_1v1, drill_2v1 (and any Picklr-venue event, already normalized
  // to rec_game in classification).
  if (type === 'rec_game' || type === 'drill_1v1' || type === 'drill_2v1') {
    if (!tracked.weekCheckSent && untilStart <= WEEK_MS) {
      actions.push({ kind: 'week_check', flag: 'weekCheckSent' });
    }
    if (!tracked.reminderSent && untilStart <= REMINDER_MS) {
      actions.push({ kind: 'reminder', flag: 'reminderSent' });
    }
  }
  return actions;
}

module.exports = { evaluateEvent, startInstant, REMINDER_MS, WEEK_MS, MONTH_MS, HOUR, DAY };
