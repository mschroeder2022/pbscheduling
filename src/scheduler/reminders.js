// Reminder orchestrator: each tick syncs the calendar, updates the store, evaluates
// triggers, posts due reminders/checks to Discord, and marks them sent so they don't
// repeat (state persists across restarts).
const cron = require('node-cron');
const log = require('../logger');
const { fetchUpcomingEvents } = require('../calendar/sync');
const { upsertFromCalendar, update, all } = require('./store');
const { evaluateEvent } = require('./triggers');
const { build, picklrResult, picklrDigest } = require('./messages');
const { sendNotification, isReady } = require('../discord/bot');
const { runPicklrCheck, gatherUpcomingPicklr } = require('../picklr/check');

async function tick(reason = 'tick') {
  let events;
  try {
    events = await fetchUpcomingEvents();
  } catch (err) {
    log.warn(`Reminder ${reason}: calendar sync failed (${err.message || err}); using stored events.`);
    events = null;
  }
  if (events) upsertFromCalendar(events);
  if (!isReady()) {
    log.warn(`Reminder ${reason}: Discord not ready, deferring all triggers.`);
    return 0;
  }

  const now = Date.now();
  let fired = 0;
  const picklrWeekChecks = []; // {tracked} — batched so one scrape covers a location

  for (const tracked of all()) {
    for (const action of evaluateEvent(tracked, now)) {
      // Picklr booking checks are AUTOMATED (read-only scrape) instead of a manual ping.
      if (action.kind === 'week_check' && tracked.isPicklrIndoor) {
        picklrWeekChecks.push(tracked);
        continue;
      }
      const ok = await sendNotification(build(action.kind, tracked));
      if (ok) { update(tracked.id, { [action.flag]: true }); fired++; log.info(`Reminder ${reason}: sent ${action.kind} for "${tracked.title.trim()}".`); }
      else log.warn(`Reminder ${reason}: failed ${action.kind} for "${tracked.title.trim()}" (will retry).`);
    }
  }

  // Run the automated Picklr checks (read-only) and post per-event results.
  if (picklrWeekChecks.length) {
    log.info(`Reminder ${reason}: auto-checking ${picklrWeekChecks.length} Picklr booking(s).`);
    const results = await runPicklrCheck(picklrWeekChecks, now);
    for (const r of results) {
      const ok = await sendNotification(picklrResult(r));
      // Mark the week check done only when the check actually ran (location reachable).
      if (ok && r.locationOk) { update(r.event.id, { weekCheckSent: true }); fired++; }
    }
  }

  if (fired) log.info(`Reminder ${reason}: ${fired} message(s) sent.`);
  return fired;
}

// Daily 7am automated Picklr reservation check for all upcoming Picklr sessions.
// Posts a booking-status digest and highlights anything not booked.
async function picklr7amJob(days = 8) {
  if (!isReady()) { log.warn('7am Picklr job: Discord not ready, skipping.'); return; }
  const events = gatherUpcomingPicklr(days);
  if (!events.length) { log.info('7am Picklr job: no upcoming Picklr sessions.'); return; }
  log.info(`7am Picklr job: checking ${events.length} upcoming Picklr session(s) (read-only).`);
  const results = await runPicklrCheck(events);
  await sendNotification(picklrDigest(results));
}

function startScheduler() {
  // Every 5 minutes — fine-grained enough for the 2-hour reminder.
  cron.schedule('*/5 * * * *', () => tick('cron'), { timezone: 'America/Phoenix' });
  log.info('Reminder scheduler started (every 5 min).');
  // One tick shortly after boot so nothing waits up to 5 min.
  setTimeout(() => tick('startup').catch(e => log.error(`startup tick: ${e.message || e}`)), 4000);
}

module.exports = { startScheduler, tick, picklr7amJob };
