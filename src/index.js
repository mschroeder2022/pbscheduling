// Resident entrypoint for the pickleball scheduling agent.
// Launched at logon by the Windows scheduled task (see scripts/install-startup.ps1).
//
// Current responsibilities (grows with each build step):
//   - On start: run a calendar sync and log upcoming events.
//   - Daily sweep (cron) for the calendar (foundation for reminders in step 4).
//   - Daily 7am Picklr reservation check hook (wired to the step-0 login; scrape
//     parsing lands in step 5).
// Later steps add: Discord bot (step 3), reminder/booking-check logic (step 4),
// Picklr scrape parsing (step 5), on-demand commands (step 6).
const cron = require('node-cron');
const log = require('./logger');
const { fetchUpcomingEvents } = require('./calendar/sync');
const { getSignedInUsername } = require('./auth/graphAuth');
const { isNoClientId, isNeedsSignIn } = require('./auth/authErrors');
const { graph, discord } = require('./config');
const { startBot, sendNotification, isReady } = require('./discord/bot');
const { startScheduler, picklr7amJob } = require('./scheduler/reminders');

async function runCalendarSweep(reason) {
  try {
    const who = await getSignedInUsername();
    if (!who) {
      log.warn(`Calendar sweep skipped (${reason}): not signed in yet. Run "node scripts/graph-auth.js" once.`);
      return;
    }
    const events = await fetchUpcomingEvents();
    log.info(`Calendar sweep (${reason}) for ${who}: ${events.length} upcoming event(s).`);
    for (const e of events) {
      const picklr = e.isPicklrIndoor ? ` [PICKLR:${e.picklrLocation}]` : '';
      log.info(`  • ${e.startTime || '(no time)'} | ${e.type} | ${e.title}${picklr}`);
    }
  } catch (err) {
    if (isNoClientId(err)) {
      log.warn(`Calendar sweep skipped (${reason}): AZURE_CLIENT_ID not set. See docs/graph-setup.md.`);
    } else if (isNeedsSignIn(err)) {
      log.warn(`Calendar sweep skipped (${reason}): needs one-time sign-in. Run "node scripts/graph-auth.js".`);
    } else {
      log.error(`Calendar sweep failed (${reason}): ${err.message || err}`);
    }
  }
}

async function startDiscord() {
  if (!discord.token) {
    log.warn('Discord disabled: DISCORD_BOT_TOKEN not set.');
    return;
  }
  try {
    await startBot();
    await sendNotification(`🟢 pb-scheduler agent started — posting to **#${discord.channelName}** in **${discord.guildName}**.`);
  } catch (err) {
    log.error(`Discord startup failed: ${err.message || err}`);
  }
}

async function main() {
  log.info('=== pbscheduling agent starting ===');
  log.info(`Calendar account: ${graph.calendarAccount} | client_id set: ${!!graph.clientId}`);

  // Connect Discord first so scheduled jobs can post.
  await startDiscord();

  // Log the classified calendar once on boot (visibility in logs/agent.log).
  await runCalendarSweep('startup');

  // Reminder engine: 2hr / 1-week / 1-month triggers with Discord confirm buttons.
  // Runs its own 5-min tick + an immediate startup tick.
  startScheduler();

  // Daily 7am automated (read-only) Picklr reservation check.
  cron.schedule('0 7 * * *', () => {
    picklr7amJob().catch(e => log.error(`7am Picklr job failed: ${e.message || e}`));
  }, { timezone: 'America/Phoenix' });

  // Hourly heartbeat so the log shows the resident process is alive after reboots.
  cron.schedule('0 * * * *', () => log.info('heartbeat: agent alive'));

  log.info('Scheduler started. Resident process running. (Ctrl+C to stop when run manually.)');
}

process.on('unhandledRejection', (e) => log.error('unhandledRejection:', e && e.message ? e.message : e));
process.on('uncaughtException', (e) => log.error('uncaughtException:', e && e.message ? e.message : e));

main();
