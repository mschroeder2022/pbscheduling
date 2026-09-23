// Discord bot: connects, resolves the target channel (Hive / pb-scheduler) by name,
// registers slash commands, and exposes sendNotification() for scheduled pushes.
const {
  Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder,
} = require('discord.js');
const log = require('../logger');
const { discord, syncWindowDays } = require('../config');
const { fetchUpcomingEvents } = require('../calendar/sync');
const { formatUpcoming, formatEventLine } = require('./format');
const store = require('../scheduler/store');

const state = { client: null, channel: null, guild: null, ready: false };

// Only pickleball-relevant events (skip 'unknown' like "Work").
function pickleballOnly(events) {
  return events.filter(e => e.type !== 'unknown' || e.isPicklrIndoor);
}

function withinDays(events, days) {
  const cutoff = new Date(Date.now() + days * 86400000);
  return events.filter(e => {
    const dt = e.startRaw && e.startRaw.dateTime ? new Date(e.startRaw.dateTime.replace(/(\.\d+)?$/, 'Z')) : null;
    return !dt || dt <= cutoff;
  });
}

function resolveChannel(client) {
  // Prefer explicit IDs if provided; otherwise resolve by name.
  let guild = discord.guildId
    ? client.guilds.cache.get(discord.guildId)
    : client.guilds.cache.find(g => g.name === discord.guildName);
  if (!guild) {
    const available = client.guilds.cache.map(g => g.name).join(', ') || '(none — bot not in any server)';
    throw new Error(`Discord server "${discord.guildName}" not found. Bot is in: ${available}. Invite the bot to the server.`);
  }
  state.guild = guild;

  let channel = discord.channelId
    ? guild.channels.cache.get(discord.channelId)
    : guild.channels.cache.find(c => c.name === discord.channelName && c.isTextBased && c.isTextBased());
  if (!channel) {
    const texts = guild.channels.cache.filter(c => c.isTextBased && c.isTextBased()).map(c => c.name).join(', ');
    throw new Error(`Channel "#${discord.channelName}" not found in "${guild.name}". Text channels: ${texts}`);
  }
  return channel;
}

async function registerCommands(client, guild) {
  const commands = [
    new SlashCommandBuilder().setName('upcoming')
      .setDescription('List tracked pickleball events for the next 7 days').toJSON(),
    new SlashCommandBuilder().setName('status')
      .setDescription('Status of a specific event (by keyword in its title)')
      .addStringOption(o => o.setName('event').setDescription('Part of the event title').setRequired(true))
      .toJSON(),
    new SlashCommandBuilder().setName('check-signups')
      .setDescription('Show sign-up / booking status for all upcoming tracked events').toJSON(),
    new SlashCommandBuilder().setName('check-picklr')
      .setDescription('Run a read-only Picklr reservation check now (takes ~1-2 min)').toJSON(),
    new SlashCommandBuilder().setName('ping')
      .setDescription('Check the pb-scheduler bot is alive').toJSON(),
  ];
  const rest = new REST({ version: '10' }).setToken(discord.token);
  // Guild-scoped registration = instant availability (no ~1h global propagation).
  await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
  log.info(`Discord: registered ${commands.length} slash command(s) in "${guild.name}".`);
}

async function handleUpcoming(interaction) {
  await interaction.deferReply();
  try {
    const events = await fetchUpcomingEvents(syncWindowDays);
    // Overlay persisted sign-up/booking status so confirmed events show correctly.
    for (const e of events) {
      const t = store.get(e.id);
      if (t) { e.signupStatus = t.signupStatus; e.bookingStatus = t.bookingStatus; }
    }
    const list = withinDays(pickleballOnly(events), 7);
    await interaction.editReply(formatUpcoming(list, 7));
  } catch (err) {
    log.error(`/upcoming failed: ${err.message || err}`);
    await interaction.editReply('Could not read the calendar right now. Check the agent logs.');
  }
}

const STATUS_WORD = { confirmed: '✅ confirmed', not_confirmed: '❌ not confirmed', unknown: '❔ unknown' };

// Show the store's status for events whose title matches the query.
async function handleStatus(interaction) {
  const q = interaction.options.getString('event').toLowerCase();
  const matches = store.all().filter(e => (e.title || '').toLowerCase().includes(q)
    && (e.type !== 'unknown' || e.isPicklrIndoor));
  if (!matches.length) return interaction.reply({ content: `No tracked event matches "${q}".`, ephemeral: true });
  const lines = matches.slice(0, 10).map(e => {
    e.startRaw = e.startISO ? { dateTime: e.startISO } : null;
    const which = e.type === 'tournament'
      ? `sign-up: ${STATUS_WORD[e.signupStatus]}`
      : `court: ${STATUS_WORD[e.bookingStatus]}`;
    return `${formatEventLine(e)}\n   → ${which}`;
  });
  return interaction.reply(lines.join('\n'));
}

// Dashboard of sign-up/booking status for all upcoming tracked events.
async function handleCheckSignups(interaction) {
  await interaction.deferReply();
  try {
    const events = await fetchUpcomingEvents(syncWindowDays);
    for (const e of events) { const t = store.get(e.id); if (t) { e.signupStatus = t.signupStatus; e.bookingStatus = t.bookingStatus; } }
    const now = Date.now();
    const list = pickleballOnly(events)
      .filter(e => { const dt = e.startRaw && e.startRaw.dateTime ? new Date(e.startRaw.dateTime.replace(/(\.\d+)?$/, 'Z')) : null; return !dt || dt >= new Date(now - 3600000); })
      .slice(0, 25);
    if (!list.length) return interaction.editReply('No upcoming tracked events.');
    const lines = list.map(e => {
      const which = e.type === 'tournament'
        ? `sign-up ${STATUS_WORD[e.signupStatus].split(' ')[0]}`
        : `court ${STATUS_WORD[e.bookingStatus].split(' ')[0]}`;
      return `${formatEventLine(e)} — ${which}`;
    });
    await interaction.editReply(['**Sign-up / booking status:**', ...lines].join('\n')
      + '\n\n_Tip: `/check-picklr` runs a live court check for Picklr sessions._');
  } catch (err) {
    log.error(`/check-signups failed: ${err.message || err}`);
    await interaction.editReply('Could not read statuses right now. Check the agent logs.');
  }
}

// Trigger a live READ-ONLY Picklr scrape now: booking status for upcoming sessions
// plus any orphan reservations (booked courts with no calendar event). Sweeps all
// locations even when the calendar has no Picklr sessions — that's exactly when an
// orphan would otherwise go unseen.
async function handleCheckPicklr(interaction) {
  await interaction.deferReply();
  // Lazy require to avoid any load-order coupling with the scheduler.
  const { runFullPicklrSweep } = require('../picklr/check');
  const { picklrDigest, picklrOrphans, picklrOrphanAlert } = require('../scheduler/messages');
  const { alertFor, markAlerted } = require('../picklr/orphans');
  try {
    await interaction.editReply('🏓 Sweeping all Picklr locations — this takes ~2-3 min (read-only, never books)...');
    const { results, orphans } = await runFullPicklrSweep();
    let content = picklrDigest(results).content;
    // Orphans the user already declined: list them, no buttons. Everything else
    // (never alerted, or still pending) gets its own approve/decline message.
    const ignored = orphans.filter(o => (alertFor(o) || {}).status === 'ignored');
    const askable = orphans.filter(o => (alertFor(o) || {}).status !== 'ignored');
    if (ignored.length) {
      content += `\n\n${picklrOrphans(ignored, {
        header: '🔕 **Booked at the Picklr, not on your calendar (you chose not to add):**',
      }).content}`;
    }
    if (askable.length) content += `\n\n🚨 ${askable.length} reservation(s) not on your calendar — see below to approve.`;
    await interaction.editReply(content);
    for (const o of askable) {
      await interaction.followUp(picklrOrphanAlert(o));
      markAlerted([o]);
    }
  } catch (err) {
    log.error(`/check-picklr failed: ${err.message || err}`);
    await interaction.editReply('Picklr check failed. Check the agent logs.');
  }
}

// Orphan-reservation buttons: pb|orphan|add|<shortId> / pb|orphan|skip|<shortId>.
// "add" is the ONLY path on which the agent writes to the Outlook calendar, and it
// runs only after the user taps the button. "skip" records the decision so the
// reservation is never added and never asked about again.
async function handleOrphanButton(interaction, answer, shortId) {
  const { getAlert, setAlertStatus } = require('../picklr/orphans');
  const { createPicklrEvent } = require('../calendar/write');
  const { needsConsent, isAuthSetupError } = require('../auth/authErrors');
  const { fmtWhen } = require('./format');

  const alert = getAlert(shortId);
  if (!alert) {
    return interaction.reply({ content: 'That reservation alert has expired (the slot is past or no longer tracked).', ephemeral: true }).catch(() => {});
  }
  const finish = (line) => interaction.editReply({
    content: `${interaction.message.content}\n\n${line}`, components: [],
  }).catch(() => interaction.followUp({ content: line, ephemeral: true }).catch(() => {}));

  if (alert.status === 'added') {
    return interaction.reply({ content: '✅ Already added to your calendar.', ephemeral: true }).catch(() => {});
  }
  if (alert.status === 'ignored') {
    return interaction.reply({ content: '🚫 You already chose not to add this one.', ephemeral: true }).catch(() => {});
  }

  // Acknowledge within Discord's 3s limit; the Graph write can take a few seconds.
  await interaction.deferUpdate().catch(() => {});

  if (answer !== 'add') {
    setAlertStatus(shortId, 'ignored', { decidedBy: interaction.user.tag });
    log.info(`Discord: ${interaction.user.tag} declined adding orphan ${alert.key} to the calendar.`);
    return finish("🚫 **Not added.** I won't add this reservation to your calendar or ask about it again.");
  }

  try {
    const created = await createPicklrEvent({ location: alert.location, reservation: alert.reservation });
    // Track it immediately (don't wait for the next calendar sync). The court is
    // known-booked, so pre-confirm booking and skip the 1-week "is it booked?" ask.
    store.upsertFromCalendar([created]);
    store.update(created.id, { bookingStatus: 'confirmed', weekCheckSent: true });
    setAlertStatus(shortId, 'added', { eventId: created.id, decidedBy: interaction.user.tag });
    log.info(`Discord: ${interaction.user.tag} approved orphan ${alert.key} — created calendar event "${created.title}" (${created.id.slice(0, 12)}…).`);
    const when = fmtWhen(created.startRaw, created.startTime);
    return finish(`✅ **Added to your Outlook calendar:** ${created.title}\n${when} · court marked booked. You'll get the usual 2-hour reminder.`);
  } catch (err) {
    log.error(`Orphan add failed for ${alert.key}: ${err.message || err}`);
    let why;
    if (isAuthSetupError(err)) {
      why = 'the agent is not signed in to Microsoft. Run `npm run auth` on the agent box, then tap the button again.';
    } else if (needsConsent(err)) {
      why = 'the agent\'s Microsoft sign-in only has **read** access to the calendar. On the agent box run `npm run auth` once to grant Calendars.ReadWrite, then tap **Add to calendar** again.';
    } else {
      why = `the calendar write failed (${String(err.message || err).slice(0, 200)}). Check the agent logs and tap the button again to retry.`;
    }
    // Leave the buttons in place so the user can retry after fixing the cause.
    return interaction.followUp({ content: `⚠️ Not added — ${why}`, ephemeral: true }).catch(() => {});
  }
}

// Handle confirm-button clicks. customId: pb|<kind>|<answer>|<shortId>
async function handleButton(interaction) {
  const parts = interaction.customId.split('|');
  if (parts[0] !== 'pb') return;
  const [, kind, answer, shortId] = parts;
  if (kind === 'orphan') return handleOrphanButton(interaction, answer, shortId);
  const tracked = store.findByShortId(shortId);
  if (!tracked) {
    return interaction.reply({ content: 'That event is no longer tracked.', ephemeral: true }).catch(() => {});
  }

  const yes = answer === 'yes';
  let confirmationLine;
  if (kind === 'signup') {
    store.update(tracked.id, { signupStatus: yes ? 'confirmed' : 'not_confirmed' });
    confirmationLine = yes
      ? `✅ Marked **signed up** — ${tracked.title}`
      : `❌ Marked **not signed up yet** — ${tracked.title} (I'll keep it on your radar).`;
  } else if (kind === 'booking') {
    store.update(tracked.id, { bookingStatus: yes ? 'confirmed' : 'not_confirmed' });
    confirmationLine = yes
      ? `✅ Marked **court booked** — ${tracked.title}`
      : `❌ Marked **court NOT booked** — ${tracked.title} (book it soon!).`;
  } else {
    return interaction.deferUpdate().catch(() => {});
  }

  log.info(`Discord: ${interaction.user.tag} answered ${kind}=${answer} for "${tracked.title}".`);
  // Edit the original message: keep the question, append the answer, drop the buttons.
  await interaction.update({
    content: `${interaction.message.content}\n\n${confirmationLine}`,
    components: [],
  }).catch(async () => {
    await interaction.reply({ content: confirmationLine, ephemeral: true }).catch(() => {});
  });
}

function startBot() {
  return new Promise((resolve, reject) => {
    if (!discord.token) {
      return reject(Object.assign(new Error('DISCORD_BOT_TOKEN not set.'), { code: 'NO_DISCORD_TOKEN' }));
    }
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    state.client = client;

    client.once(Events.ClientReady, async (c) => {
      try {
        log.info(`Discord: logged in as ${c.user.tag}`);
        state.channel = resolveChannel(client);
        await registerCommands(client, state.guild);
        state.ready = true;
        log.info(`Discord: posting to #${state.channel.name} in "${state.guild.name}".`);
        resolve({ client, channel: state.channel });
      } catch (err) {
        reject(err);
      }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
      if (interaction.isButton()) return handleButton(interaction);
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === 'upcoming') return handleUpcoming(interaction);
      if (interaction.commandName === 'status') return handleStatus(interaction);
      if (interaction.commandName === 'check-signups') return handleCheckSignups(interaction);
      if (interaction.commandName === 'check-picklr') return handleCheckPicklr(interaction);
      if (interaction.commandName === 'ping') return interaction.reply('🏓 pong — pb-scheduler is running.');
    });

    client.on(Events.Error, (e) => log.error(`Discord client error: ${e.message || e}`));
    client.login(discord.token).catch(reject);
  });
}

// Post a notification to the resolved channel. Accepts a string or a message payload.
async function sendNotification(payload) {
  if (!state.ready || !state.channel) {
    log.warn('sendNotification called before Discord was ready; dropping message.');
    return false;
  }
  try {
    await state.channel.send(payload);
    return true;
  } catch (err) {
    log.error(`sendNotification failed: ${err.message || err}`);
    return false;
  }
}

function isReady() { return state.ready; }

module.exports = { startBot, sendNotification, isReady };
