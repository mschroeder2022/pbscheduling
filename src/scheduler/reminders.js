// Reminder orchestrator: each tick syncs the calendar, updates the store, evaluates
// triggers, posts due reminders/checks to Discord, and marks them sent so they don't
// repeat (state persists across restarts).
const cron = require('node-cron');
const log = require('../logger');
const { fetchUpcomingEvents } = require('../calendar/sync');
const { upsertFromCalendar, update, all } = require('./store');
const { evaluateEvent } = require('./triggers');
const { build, picklrResult, picklrDigest, picklrOrphanAlert } = require('./messages');
const { sendNotification, isReady } = require('../discord/bot');
const { runPicklrCheck, runFullPicklrSweep } = require('../picklr/check');
const { filterUnalerted, markAlerted } = require('../picklr/orphans');

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

// Daily 7am automated Picklr reservation check. Scrapes ALL locations so it can
// both verify upcoming sessions are booked AND catch orphan reservations (booked
// courts with no calendar event) — which is why it no longer skips when the
// calendar has no Picklr sessions. Each orphan is alerted once, as its own message
// with "Add to calendar" / "Don't add" buttons; the Outlook event is only created
// when the user approves (see discord/bot.js handleOrphanButton).
async function picklr7amJob(days = 8) {
  if (!isReady()) { log.warn('7am Picklr job: Discord not ready, skipping.'); return; }
  log.info('7am Picklr job: full read-only sweep of all Picklr locations.');
  const { results, orphans } = await runFullPicklrSweep(Date.now(), days);
  if (results.length) await sendNotification(picklrDigest(results));
  else log.info('7am Picklr job: no upcoming Picklr sessions on the calendar.');
  await alertNewOrphans(orphans);
}

// Post one approve/decline alert per not-yet-alerted orphan. Returns how many fired.
async function alertNewOrphans(orphans, send = sendNotification) {
  const fresh = filterUnalerted(orphans);
  let fired = 0;
  for (const o of fresh) {
    const ok = await send(picklrOrphanAlert(o));
    if (ok) { markAlerted([o]); fired++; }
  }
  if (fired) log.info(`Orphan alerts: posted ${fired} approve/decline prompt(s) to Discord.`);
  return fired;
}

function startScheduler() {
  // Every 5 minutes — fine-grained enough for the 2-hour reminder.
  cron.schedule('*/5 * * * *', () => tick('cron'), { timezone: 'America/Phoenix' });
  log.info('Reminder scheduler started (every 5 min).');
  // One tick shortly after boot so nothing waits up to 5 min.
  setTimeout(() => tick('startup').catch(e => log.error(`startup tick: ${e.message || e}`)), 4000);
}

module.exports = { startScheduler, tick, picklr7amJob, alertNewOrphans };
