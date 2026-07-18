// Manual test of read-only calendar sync. Prints the next N days of classified
// events. Requires a completed `node scripts/graph-auth.js` first.
const { fetchUpcomingEvents } = require('../src/calendar/sync');
const { syncWindowDays } = require('../src/config');
const { isNoClientId, isNeedsSignIn } = require('../src/auth/authErrors');

(async () => {
  try {
    const events = await fetchUpcomingEvents(syncWindowDays);
    console.log(`\nFound ${events.length} event(s) in the next ${syncWindowDays} days:\n`);
    for (const e of events) {
      const picklr = e.isPicklrIndoor ? `  [PICKLR: ${e.picklrLocation}]` : '';
      console.log(`- ${e.startTime || '(no time)'}  |  ${e.type.padEnd(11)}  |  ${e.title}${picklr}`);
      if (e.location) console.log(`    location: ${e.location}`);
    }
    console.log('');
  } catch (err) {
    if (isNoClientId(err)) {
      console.error('\nAZURE_CLIENT_ID is not set. Create an Azure app registration, put the');
      console.error('client ID in .env, then run: node scripts/graph-auth.js  (see docs/graph-setup.md)\n');
      process.exit(2);
    }
    if (isNeedsSignIn(err)) {
      console.error('\nNot signed in yet. Run once: node scripts/graph-auth.js\n');
      process.exit(2);
    }
    console.error('Calendar sync failed:', err.message || err);
    process.exit(1);
  }
})();
