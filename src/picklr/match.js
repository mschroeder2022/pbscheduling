// Match a tracked calendar event to a Picklr reservation.
// A calendar event's startISO is Phoenix-local wall-clock (e.g. "2026-07-21T16:00:00").
// A reservation has dateISO (YYYY-MM-DD) + startTime ("HH:MM"). We match on same
// calendar date and start time within a tolerance (default 60 min) since the user's
// event block may not start exactly when the court slot does.
const { cleanIso } = require('../scheduler/store');

function eventDateAndMinutes(tracked) {
  if (!tracked.startISO) return null;
  const iso = cleanIso(tracked.startISO); // "2026-07-21T16:00:00"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return { dateISO: `${m[1]}-${m[2]}-${m[3]}`, minutes: parseInt(m[4], 10) * 60 + parseInt(m[5], 10) };
}

function resMinutes(r) {
  const m = (r.startTime || '').match(/^(\d{2}):(\d{2})$/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

// Returns the matching reservation (or null). toleranceMin: allowed start-time drift.
function findReservationForEvent(tracked, reservations, toleranceMin = 60) {
  const ev = eventDateAndMinutes(tracked);
  if (!ev) return null;
  let best = null, bestDelta = Infinity;
  for (const r of reservations) {
    if (r.dateISO !== ev.dateISO) continue;
    const rm = resMinutes(r);
    if (rm == null) continue;
    const delta = Math.abs(rm - ev.minutes);
    if (delta <= toleranceMin && delta < bestDelta) { best = r; bestDelta = delta; }
  }
  return best;
}

// True if the event has a Booked reservation.
function isBooked(tracked, reservations) {
  const r = findReservationForEvent(tracked, reservations);
  return !!(r && /booked/i.test(r.status || ''));
}

module.exports = { findReservationForEvent, isBooked, eventDateAndMinutes };
