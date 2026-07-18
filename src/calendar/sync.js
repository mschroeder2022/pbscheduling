// Read-only calendar sync: pull upcoming events from the configured account and
// classify them. Uses Graph's calendarView so recurring events are expanded into
// individual occurrences.
const { getGraphClient } = require('./graphClient');
const { classifyEvent } = require('./classify');
const { syncWindowDays } = require('../config');

// Build an ISO window [now, now + days] without Date.now caveats (plain Node here).
function windowIso(days) {
  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function fetchUpcomingEvents(days = syncWindowDays) {
  const client = getGraphClient();
  const { startIso, endIso } = windowIso(days);

  let request = client
    .api('/me/calendarView')
    .query({ startDateTime: startIso, endDateTime: endIso })
    .header('Prefer', 'outlook.timezone="America/Phoenix"')
    .select('id,subject,location,locations,start,end,isAllDay,seriesMasterId,type')
    .orderby('start/dateTime')
    .top(100);

  const events = [];
  let page = await request.get();
  while (page) {
    for (const ev of page.value || []) events.push(classifyEvent(ev));
    if (page['@odata.nextLink']) {
      page = await client.api(page['@odata.nextLink']).get();
    } else {
      page = null;
    }
  }
  return events;
}

module.exports = { fetchUpcomingEvents };
