// Parse the Picklr reservations page innerText into structured reservations.
// The page renders each reservation as a flat block:
//   RESERVATION / <Paid|Unpaid> / <venue> / » Court N / <Day, Mon D> / HH:MM AM - HH:MM PM / Booked / <initials...>
const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
const TIME_RANGE = /(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i;
const DATE_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+([A-Za-z]{3,})\s+(\d{1,2})$/;
const COURT_RE = /Court\s*(\d+)/i;

function to24h(h, m, ap) {
  h = parseInt(h, 10); m = parseInt(m, 10);
  ap = ap.toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return { h, m };
}

// Infer the year for a month/day with no year: pick the occurrence nearest to now
// (allow recently-past within ~60 days, otherwise assume upcoming).
function inferYear(month, day, nowMs) {
  const now = new Date(nowMs);
  let year = now.getUTCFullYear();
  let d = new Date(Date.UTC(year, month, day));
  const sixtyDays = 60 * 86400000;
  if (d.getTime() < now.getTime() - sixtyDays) year += 1;
  else if (d.getTime() > now.getTime() + 300 * 86400000) year -= 1;
  return year;
}

function parseReservations(innerText, nowMs = Date.now()) {
  const lines = innerText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const reservations = [];

  // Walk lines, starting a new block at each "RESERVATION" marker.
  let i = 0;
  while (i < lines.length) {
    if (!/^RESERVATION$/i.test(lines[i])) { i++; continue; }
    // Collect this block until the next RESERVATION or a section boundary.
    const block = [];
    i++;
    while (i < lines.length && !/^RESERVATION$/i.test(lines[i]) &&
           !/^(Priority Requests|Programs|View history)$/i.test(lines[i])) {
      block.push(lines[i]); i++;
    }

    const r = { court: null, dateText: null, startTime: null, endTime: null,
      status: null, paid: null, month: null, day: null, year: null, dateISO: null };
    for (const line of block) {
      let m;
      if ((m = line.match(COURT_RE)) && r.court == null) r.court = parseInt(m[1], 10);
      else if ((m = line.match(DATE_RE)) && !r.dateText) {
        r.dateText = line;
        const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
        if (mon != null) { r.month = mon; r.day = parseInt(m[3], 10); }
      } else if ((m = line.match(TIME_RANGE)) && !r.startTime) {
        const s = to24h(m[1], m[2], m[3]); const e = to24h(m[4], m[5], m[6]);
        r.startTime = `${String(s.h).padStart(2,'0')}:${String(s.m).padStart(2,'0')}`;
        r.endTime = `${String(e.h).padStart(2,'0')}:${String(e.m).padStart(2,'0')}`;
        r._sh = s.h; r._sm = s.m;
      } else if (/^Booked$/i.test(line)) r.status = 'Booked';
      else if (/^(Cancell?ed|Reserved)$/i.test(line)) r.status = line;
      else if (/^Paid$/i.test(line)) r.paid = 'Paid';
      else if (/^Unpaid$/i.test(line) && r.paid == null) r.paid = 'Unpaid';
    }

    if (r.month != null && r.startTime) {
      r.year = inferYear(r.month, r.day, nowMs);
      r.dateISO = `${r.year}-${String(r.month + 1).padStart(2,'0')}-${String(r.day).padStart(2,'0')}`;
      reservations.push(r);
    }
  }
  return reservations;
}

module.exports = { parseReservations, to24h, inferYear };
