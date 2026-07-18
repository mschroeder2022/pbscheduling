// Formatting helpers for Discord messages.

const TYPE_LABEL = {
  tournament: 'Tournament',
  rec_game: 'Rec game',
  drill_1v1: '1v1 drilling',
  drill_2v1: '2v1 drilling',
  unknown: 'Untagged',
};

function fmtWhen(startRaw, fallback) {
  // startRaw is Graph's { dateTime, timeZone }. Render a compact local-ish string.
  if (startRaw && startRaw.dateTime) {
    const d = new Date(startRaw.dateTime.replace(/(\.\d+)?$/, 'Z')); // treat as wall-clock
    if (!isNaN(d)) {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      let h = d.getUTCHours();
      const m = d.getUTCMinutes().toString().padStart(2, '0');
      const ap = h >= 12 ? 'pm' : 'am';
      h = h % 12 || 12;
      return `${days[d.getUTCDay()]} ${mons[d.getUTCMonth()]} ${d.getUTCDate()}, ${h}:${m}${ap}`;
    }
  }
  return fallback || '(no time)';
}

function statusBadge(s) {
  if (s === 'confirmed') return '✅';
  if (s === 'not_confirmed') return '❌';
  return '❔';
}

// One line per event for the /upcoming list.
function formatEventLine(e) {
  const type = TYPE_LABEL[e.type] || e.type;
  const when = fmtWhen(e.startRaw, e.startTime);
  const venue = e.isPicklrIndoor ? ` · 🏓 Picklr ${e.picklrLocation}` : (e.location ? ` · ${e.location}` : '');
  // Show booking status for rec/drills, signup status for tournaments.
  let status = '';
  if (e.type === 'tournament') status = ` · signup ${statusBadge(e.signupStatus)}`;
  else if (e.type !== 'unknown') status = ` · court ${statusBadge(e.bookingStatus)}`;
  return `• **${when}** — ${e.title} _(${type})_${venue}${status}`;
}

function formatUpcoming(events, days) {
  if (!events.length) return `No tracked pickleball events in the next ${days} days.`;
  const header = `**Upcoming pickleball — next ${days} days** (${events.length}):`;
  return [header, ...events.map(formatEventLine)].join('\n');
}

module.exports = { formatUpcoming, formatEventLine, fmtWhen, TYPE_LABEL };
