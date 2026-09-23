// The ONLY place the agent writes to the Outlook calendar. It runs exclusively when
// the user taps "Add to calendar" on an orphan-reservation alert in Discord — the
// agent never creates events on its own (SPEC.md section 1).
//
// Uses the WRITE-scoped Graph client (Calendars.ReadWrite). If the cached consent
// is read-only, the call fails with an interaction-required error that the caller
// maps to a "re-run npm run auth" message (see authErrors.needsConsent).
const { getGraphClient } = require('./graphClient');
const { classifyEvent } = require('./classify');

const LOC_LABEL = { scottsdalenorth: 'Scottsdale North', tempe: 'Tempe', mesa: 'Mesa' };
const TZ = 'America/Phoenix';

function locationLabel(loc) { return LOC_LABEL[loc] || loc; }

// Pure: build the Graph event body for an orphan { location, reservation }.
//  - Title contains "Rec" so classify.inferType() tags it rec_game (2hr reminder +
//    1-week booking check).
//  - Location contains the venue name so classify.inferPicklr() maps it back to the
//    same Picklr location (and the 7am job keeps verifying it).
function buildPicklrEventPayload(orphan, nowMs = Date.now()) {
  const { location, reservation: r } = orphan;
  const label = locationLabel(location);
  if (!r || !r.dateISO || !r.startTime || !r.endTime) {
    throw new Error('Reservation is missing date/time — cannot build a calendar event.');
  }
  const approvedOn = new Date(nowMs).toLocaleString('en-US', { timeZone: TZ });
  return {
    subject: `Rec game @ The Picklr ${label} (Court ${r.court})`,
    location: { displayName: `The Picklr - ${label}` },
    start: { dateTime: `${r.dateISO}T${r.startTime}:00`, timeZone: TZ },
    end: { dateTime: `${r.dateISO}T${r.endTime}:00`, timeZone: TZ },
    body: {
      contentType: 'text',
      content: [
        `Picklr ${label} — Court ${r.court}, ${r.startTime}–${r.endTime}${r.paid ? ` (${r.paid})` : ''}.`,
        `Added by pb-scheduler from your Picklr reservation, approved in Discord on ${approvedOn}.`,
      ].join('\n'),
    },
    showAs: 'busy',
  };
}

// Create the event. Returns the classified event (same shape the sync produces) so
// the caller can drop it straight into the tracking store.
async function createPicklrEvent(orphan, nowMs = Date.now()) {
  const payload = buildPicklrEventPayload(orphan, nowMs);
  const client = getGraphClient({ write: true });
  const created = await client
    .api('/me/events')
    .header('Prefer', `outlook.timezone="${TZ}"`) // response times come back Phoenix-local, like the sync
    .post(payload);
  return classifyEvent(created);
}

module.exports = { buildPicklrEventPayload, createPicklrEvent, locationLabel, LOC_LABEL };
