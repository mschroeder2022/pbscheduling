// Event classification per the SPEC.md spec:
//  - type inferred from the TITLE keyword (tournament | rec | drilling)
//  - is_picklr_indoor / picklr_location inferred from the LOCATION field
const PICKLR_VENUES = [
  { key: 'scottsdalenorth', patterns: [/scottsdale\s*north/i, /scottsdalenorth/i], url: 'https://scottsdalenorth.thepicklr.com/account/reservations' },
  { key: 'tempe', patterns: [/\btempe\b/i], url: 'https://tempe.thepicklr.com/account/reservations' },
  { key: 'mesa', patterns: [/\bmesa\b/i], url: 'https://mesa.thepicklr.com/account/reservations' },
];

// Title keyword -> event type. "drilling" covers 1v1/2v1; we refine with v-notation.
function inferType(title = '') {
  const t = title.toLowerCase();
  if (t.includes('tournament')) return 'tournament';
  if (t.includes('drilling')) {
    if (/\b2v2\b|\b2\s*v\s*2\b/.test(t)) return 'drill_2v1'; // spec lists 2v1; keep generic drilling bucket
    if (/\b2v1\b|\b2\s*v\s*1\b/.test(t)) return 'drill_2v1';
    if (/\b1v1\b|\b1\s*v\s*1\b/.test(t)) return 'drill_1v1';
    return 'drill_1v1';
  }
  if (t.includes('rec')) return 'rec_game';
  return 'unknown';
}

function inferPicklr(location = '') {
  const loc = location || '';
  for (const v of PICKLR_VENUES) {
    if (v.patterns.some(re => re.test(loc))) {
      return { isPicklrIndoor: true, picklrLocation: v.key, reservationUrl: v.url };
    }
  }
  return { isPicklrIndoor: false, picklrLocation: null, reservationUrl: null };
}

// Map a raw Graph event into our Event model (SPEC.md section 4).
function classifyEvent(graphEvent) {
  const title = graphEvent.subject || '';
  const location =
    (graphEvent.location && graphEvent.location.displayName) ||
    (graphEvent.locations && graphEvent.locations[0] && graphEvent.locations[0].displayName) ||
    '';
  let type = inferType(title);
  const picklr = inferPicklr(location);

  // Broadened rule: an event at a Picklr venue with no explicit keyword is treated
  // as a rec game by default, so it still gets the 1-week booking check. Non-Picklr
  // events with no keyword stay 'unknown'.
  let typeInferredFromVenue = false;
  if (type === 'unknown' && picklr.isPicklrIndoor) {
    type = 'rec_game';
    typeInferredFromVenue = true;
  }

  return {
    id: graphEvent.id,
    title,
    type, // tournament | rec_game | drill_1v1 | drill_2v1 | unknown
    typeInferredFromVenue, // true => defaulted to rec_game from the Picklr location, not the title
    location,
    isPicklrIndoor: picklr.isPicklrIndoor,
    picklrLocation: picklr.picklrLocation,
    reservationUrl: picklr.reservationUrl,
    startTime: graphEvent.start && graphEvent.start.dateTime
      ? `${graphEvent.start.dateTime}${graphEvent.start.timeZone ? ' ' + graphEvent.start.timeZone : ''}`
      : null,
    startRaw: graphEvent.start || null,
    endRaw: graphEvent.end || null,
    // Tracking fields (managed by the scheduler in later steps):
    signupStatus: 'unknown',
    bookingStatus: 'unknown',
    reminderSent: false,
    weekCheckSent: false,
    monthCheckSent: false,
  };
}

module.exports = { classifyEvent, inferType, inferPicklr, PICKLR_VENUES };
