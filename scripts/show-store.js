// Quick inspector for the tracking store.
const s = require('../src/scheduler/store');
const a = s.all().filter(e => e.type !== 'unknown' || e.isPicklrIndoor);
console.log(`tracked pickleball events: ${a.length}\n`);
for (const e of a) {
  console.log(`  ${e.shortId} | ${e.type.padEnd(10)} | wk=${e.weekCheckSent} mo=${e.monthCheckSent} rem=${e.reminderSent} | book=${e.bookingStatus} signup=${e.signupStatus} | ${e.title.trim()}`);
}
