// Live end-to-end test / manual run of the READ-ONLY Picklr check against the store.
const { runPicklrCheck, gatherUpcomingPicklr } = require('../src/picklr/check');

(async () => {
  const days = parseInt(process.argv[2] || '8', 10);
  const events = gatherUpcomingPicklr(days);
  console.log(`Upcoming Picklr events in next ${days} days: ${events.length}`);
  events.forEach(e => console.log(`  - ${e.startISO} | ${e.picklrLocation} | ${e.title.trim()}`));
  if (!events.length) return;

  console.log('\nRunning read-only reservation check...\n');
  const results = await runPicklrCheck(events);
  console.log('\n===== RESULTS =====');
  for (const r of results) {
    const when = r.event.startISO.replace(/(\.\d+)?$/, '');
    if (!r.locationOk) { console.log(`  ⚠️  ${r.event.title.trim()} (${when}) — check failed: ${r.error}`); continue; }
    if (r.booked) {
      console.log(`  ✅ ${r.event.title.trim()} (${when}) — BOOKED (Court ${r.reservation.court}, ${r.reservation.startTime}-${r.reservation.endTime})`);
    } else {
      console.log(`  ❌ ${r.event.title.trim()} (${when}) — NOT booked`);
    }
  }
})();
