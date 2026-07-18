// Orchestrates a READ-ONLY Picklr reservation check for a set of tracked events:
// scrapes each needed location once, matches events to reservations, and updates
// each event's bookingStatus in the store. Returns per-event results for messaging.
const log = require('../logger');
const { checkLocation } = require('./scraper');
const { findReservationForEvent, eventDateAndMinutes } = require('./match');
const { update, all } = require('../scheduler/store');

// Upcoming (future) Picklr events within `days`, soonest first.
function gatherUpcomingPicklr(days = 8, nowMs = Date.now()) {
  const cutoff = nowMs + days * 86400000;
  return all()
    .filter(e => e.isPicklrIndoor && e.startISO)
    .map(e => ({ e, ev: eventDateAndMinutes(e) }))
    .filter(({ e }) => {
      const t = new Date(`${e.startISO.replace(/(\.\d+)?$/, '')}-07:00`).getTime();
      return t >= nowMs && t <= cutoff;
    })
    .sort((a, b) => (a.e.startISO < b.e.startISO ? -1 : 1))
    .map(({ e }) => e);
}

// events: array of tracked events with isPicklrIndoor === true.
// Returns [{ event, locationOk, booked, reservation, error }].
async function runPicklrCheck(events, nowMs = Date.now()) {
  const byLoc = new Map();
  for (const e of events) {
    if (!e.isPicklrIndoor || !e.picklrLocation) continue;
    if (!byLoc.has(e.picklrLocation)) byLoc.set(e.picklrLocation, []);
    byLoc.get(e.picklrLocation).push(e);
  }

  const results = [];
  for (const [loc, locEvents] of byLoc) {
    const scan = await checkLocation(loc, nowMs); // one headed scrape per location
    for (const event of locEvents) {
      if (!scan.ok) {
        results.push({ event, locationOk: false, booked: null, reservation: null, error: scan.error });
        continue;
      }
      const reservation = findReservationForEvent(event, scan.reservations);
      const booked = !!(reservation && /booked/i.test(reservation.status || ''));
      // Update booking status. Only downgrade to not_confirmed from unknown/not_confirmed;
      // never overwrite a human 'confirmed' with a scraper miss.
      const patch = { bookingStatus: booked ? 'confirmed' : (event.bookingStatus === 'confirmed' ? 'confirmed' : 'not_confirmed') };
      update(event.id, patch);
      results.push({ event, locationOk: true, booked, reservation });
      log.info(`[picklr:${loc}] "${event.title.trim()}" -> ${booked ? 'BOOKED' : 'not booked'}`);
    }
  }
  return results;
}

module.exports = { runPicklrCheck, gatherUpcomingPicklr };
