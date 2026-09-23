// Unit tests for the approve-orphan flow's pure pieces (no network, no Discord):
//  - the Graph event payload built for an approved Picklr reservation
//  - that payload round-trips through our own classifier (title => rec_game,
//    location => the same Picklr venue) so the new event is tracked like a manual one
//  - the Discord alert message carries exactly one add + one skip button
//  - needsConsent() recognizes the "read-only token" failure shapes
const { buildPicklrEventPayload } = require('../src/calendar/write');
const { classifyEvent } = require('../src/calendar/classify');
const { picklrOrphanAlert } = require('../src/scheduler/messages');
const { needsConsent } = require('../src/auth/authErrors');
const { orphanShortId } = require('../src/picklr/orphans');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); }
  else { fail++; console.log(`  FAIL- ${name}`); }
}

const now = Date.UTC(2026, 8, 22, 19, 0, 0);
const reservation = {
  court: 1, dateText: 'Wed, Sep 23', startTime: '15:00', endTime: '16:30',
  status: 'Booked', paid: 'Paid', dateISO: '2026-09-23',
};

for (const [loc, label] of [['tempe', 'Tempe'], ['scottsdalenorth', 'Scottsdale North'], ['mesa', 'Mesa']]) {
  const key = `${loc}|2026-09-23|15:00|c1`;
  const orphan = { location: loc, reservation, key, shortId: orphanShortId(key), startMs: 0 };
  const p = buildPicklrEventPayload(orphan, now);

  check(`[${loc}] subject names venue + court`, p.subject === `Rec game @ The Picklr ${label} (Court 1)`);
  check(`[${loc}] start/end are Phoenix wall-clock from the reservation`,
    p.start.dateTime === '2026-09-23T15:00:00' && p.end.dateTime === '2026-09-23T16:30:00'
      && p.start.timeZone === 'America/Phoenix' && p.end.timeZone === 'America/Phoenix');
  check(`[${loc}] body records provenance (Discord approval)`, /approved in Discord/.test(p.body.content));

  // Round-trip through the classifier as if Graph handed the event back to the sync.
  const ev = classifyEvent({ id: `id-${loc}`, subject: p.subject, location: p.location, start: p.start, end: p.end });
  check(`[${loc}] classifies as rec_game from the title keyword`, ev.type === 'rec_game' && !ev.typeInferredFromVenue);
  check(`[${loc}] location maps back to the same Picklr venue`, ev.isPicklrIndoor && ev.picklrLocation === loc);

  const msg = picklrOrphanAlert(orphan);
  const buttons = msg.components[0].components.map(b => b.toJSON());
  check(`[${loc}] alert has add + skip buttons keyed by shortId`,
    buttons.length === 2
      && buttons[0].custom_id === `pb|orphan|add|${orphan.shortId}`
      && buttons[1].custom_id === `pb|orphan|skip|${orphan.shortId}`
      && buttons.every(b => b.custom_id.length <= 100));
  check(`[${loc}] alert text says nothing is added without approval`, /Nothing is added unless you approve/.test(msg.content));
}

// Missing time data must fail loudly rather than create a bogus all-day event.
let threw = false;
try { buildPicklrEventPayload({ location: 'tempe', reservation: { court: 2, dateISO: '2026-09-23' } }, now); }
catch { threw = true; }
check('payload builder rejects a reservation with no start/end time', threw);

// needsConsent(): the shapes we expect when the cached token is read-only.
check('MSAL InteractionRequiredAuthError => needsConsent',
  needsConsent(Object.assign(new Error('AADSTS65001: consent required'), { name: 'InteractionRequiredAuthError', errorCode: 'interaction_required' })));
check('MSAL invalid_grant errorCode => needsConsent', needsConsent({ errorCode: 'invalid_grant', message: 'x' }));
check('Graph 403 => needsConsent', needsConsent({ statusCode: 403, code: 'ErrorAccessDenied', message: 'Access is denied.' }));
check('unrelated error => not consent', !needsConsent(new Error('ECONNRESET')));
check('missing sign-in is not reported as consent', !needsConsent({ code: 'NEEDS_INTERACTIVE_SIGN_IN', message: 'No cached Microsoft account' }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
