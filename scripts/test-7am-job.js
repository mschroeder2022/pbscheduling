// End-to-end test of the 7am Picklr job: connect Discord, run the read-only check,
// post the digest to #pb-scheduler, then exit. (Same code the 7am cron runs.)
const { startBot } = require('../src/discord/bot');
const { picklr7amJob } = require('../src/scheduler/reminders');

(async () => {
  try {
    await startBot();
    await picklr7amJob(8);
    console.log('7am job completed; digest posted.');
    await new Promise(r => setTimeout(r, 1500));
    process.exit(0);
  } catch (err) {
    console.error('7am job test failed:', err.message || err);
    process.exit(1);
  }
})();
