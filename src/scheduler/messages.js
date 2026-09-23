// Builds the Discord message payloads (content + confirm buttons) for each trigger.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { fmtWhen } = require('../discord/format');

// customId format: pb|<kind>|<answer>|<shortId>   (kind: signup|booking)
function confirmRow(kind, shortId, yesLabel, noLabel) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pb|${kind}|yes|${shortId}`).setLabel(yesLabel).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`pb|${kind}|no|${shortId}`).setLabel(noLabel).setStyle(ButtonStyle.Danger),
  );
}

function when(tracked) {
  return fmtWhen(tracked.startISO ? { dateTime: tracked.startISO } : null, tracked.startISO || '(no time)');
}

function venueSuffix(tracked) {
  if (tracked.isPicklrIndoor) return ` · 🏓 Picklr ${tracked.picklrLocation}`;
  return tracked.location ? ` · ${tracked.location}` : '';
}

function build(kind, tracked) {
  const w = when(tracked);
  switch (kind) {
    case 'month_check': // tournament signup, ~1 month out
      return {
        content: `🏆 **Tournament ~1 month out:** ${tracked.title}\n${w}${venueSuffix(tracked)}\nHave you signed up?`,
        components: [confirmRow('signup', tracked.shortId, '✅ Signed up', '❌ Not yet')],
      };
    case 'week_check': { // rec/drill booking, ~1 week out
      const picklrNote = tracked.isPicklrIndoor
        ? '\n_(Picklr indoor — step 5 will auto-check this at 7am; confirm manually for now.)_'
        : '';
      return {
        content: `📅 **~1 week out:** ${tracked.title}\n${w}${venueSuffix(tracked)}\nIs the court booked?${picklrNote}`,
        components: [confirmRow('booking', tracked.shortId, '✅ Booked', '❌ Not booked')],
      };
    }
    case 'reminder': // 2 hours before
      return {
        content: `⏰ **Starting in ~2 hours:** ${tracked.title}\n${w}${venueSuffix(tracked)}`,
        components: [],
      };
    default:
      return { content: `(${kind}) ${tracked.title}`, components: [] };
  }
}

// Messages for the automated Picklr reservation check (step 5).
function picklrResult(result) {
  const t = result.event;
  const w = when(t);
  if (!result.locationOk) {
    return {
      content: `⚠️ **Couldn't auto-check Picklr** for ${t.title.trim()} (${w}). I'll retry; you can also confirm manually.`,
      components: [confirmRow('booking', t.shortId, '✅ Booked', '❌ Not booked')],
    };
  }
  if (result.booked) {
    const r = result.reservation;
    return {
      content: `✅ **Court booked (auto-confirmed):** ${t.title.trim()}\n${w} · 🏓 Picklr ${t.picklrLocation}\nCourt ${r.court}, ${r.startTime}-${r.endTime}${r.paid ? ` · ${r.paid}` : ''}`,
      components: [],
    };
  }
  return {
    content: `❌ **No Picklr reservation found** for ${t.title.trim()}\n${w} · 🏓 Picklr ${t.picklrLocation}\nThe court doesn't appear booked yet. Book it, or mark it below if I missed it.`,
    components: [confirmRow('booking', t.shortId, '✅ Booked', '❌ Not booked')],
  };
}

// A morning digest summarizing booking status for upcoming Picklr events.
function picklrDigest(results) {
  if (!results.length) return { content: '🏓 No upcoming Picklr sessions to check.', components: [] };
  const lines = results.map(r => {
    const t = r.event;
    const w = when(t);
    if (!r.locationOk) return `⚠️ ${w} — ${t.title.trim()} (check failed)`;
    if (r.booked) return `✅ ${w} — ${t.title.trim()} (Court ${r.reservation.court})`;
    return `❌ ${w} — ${t.title.trim()} — NOT booked`;
  });
  const anyMissing = results.some(r => r.locationOk && !r.booked);
  const header = anyMissing
    ? '🏓 **Picklr booking check** — ⚠️ some courts are NOT booked:'
    : '🏓 **Picklr booking check** — all upcoming courts are booked:';
  return { content: [header, ...lines].join('\n'), components: [] };
}

// Alert for orphan reservations: booked Picklr courts with no matching calendar event.
const LOC_LABEL = { scottsdalenorth: 'Scottsdale North', tempe: 'Tempe', mesa: 'Mesa' };

function fmt12h(hhmm) {
  const m = (hhmm || '').match(/^(\d{2}):(\d{2})$/);
  if (!m) return hhmm || '?';
  let h = parseInt(m[1], 10);
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m[2]}${ap}`;
}

function orphanLine(o) {
  const r = o.reservation;
  return `**${r.dateText}, ${fmt12h(r.startTime)}–${fmt12h(r.endTime)}** — 🏓 Picklr ${LOC_LABEL[o.location] || o.location} · Court ${r.court}${r.paid ? ` · ${r.paid}` : ''}`;
}

// Plain summary list (no buttons) — used for orphans the user already dismissed.
function picklrOrphans(orphans, { header, footer } = {}) {
  const lines = orphans.map(o => `• ${orphanLine(o)}`);
  const head = header || (orphans.length === 1
    ? '🚨 **Picklr reservation NOT on your calendar:**'
    : `🚨 **${orphans.length} Picklr reservations NOT on your calendar:**`);
  const parts = [head, ...lines];
  if (footer) parts.push(footer);
  return { content: parts.join('\n'), components: [] };
}

// One alert per orphan with approve/decline buttons. The agent only creates the
// Outlook event if the user taps "Add to calendar" (customId pb|orphan|add|<shortId>).
function picklrOrphanAlert(orphan) {
  const label = LOC_LABEL[orphan.location] || orphan.location;
  const title = `Rec game @ The Picklr ${label} (Court ${orphan.reservation.court})`;
  return {
    content: [
      '🚨 **Picklr reservation NOT on your calendar**',
      orphanLine(orphan),
      `Add it to your Outlook calendar? I'd create **${title}** for that time slot. Nothing is added unless you approve.`,
    ].join('\n'),
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pb|orphan|add|${orphan.shortId}`).setLabel('➕ Add to calendar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`pb|orphan|skip|${orphan.shortId}`).setLabel("🚫 Don't add").setStyle(ButtonStyle.Secondary),
    )],
  };
}

module.exports = { build, picklrResult, picklrDigest, picklrOrphans, picklrOrphanAlert, orphanLine, fmt12h, LOC_LABEL };
