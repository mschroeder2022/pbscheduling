// Test the reservations parser against the real captured innerText.
const fs = require('fs');
const path = require('path');
const { parseReservations } = require('../src/picklr/parse');

const file = path.join(__dirname, '..', 'recon-out', 'scottsdalenorth-reservations.txt');
const raw = fs.readFileSync(file, 'utf8');
const innerText = raw.split('===== innerText =====')[1].split('===== CARD CANDIDATES')[0];

// Parse relative to a fixed "now" near the reservations so year inference is stable.
const now = Date.UTC(2026, 6, 18);
const res = parseReservations(innerText, now);

console.log(`Parsed ${res.length} reservation(s):\n`);
for (const r of res) {
  console.log(`  Court ${r.court} | ${r.dateISO} ${r.startTime}-${r.endTime} | ${r.status} | ${r.paid}`);
}

const expect = [
  { court: 8, dateISO: '2026-07-21', startTime: '16:00', status: 'Booked' },
  { court: 8, dateISO: '2026-07-23', startTime: '17:00', status: 'Booked' },
  { court: 9, dateISO: '2026-07-23', startTime: '18:00', status: 'Booked' },
];
let ok = res.length === expect.length;
expect.forEach((e, i) => {
  const r = res[i] || {};
  const match = r.court === e.court && r.dateISO === e.dateISO && r.startTime === e.startTime && r.status === e.status;
  if (!match) { ok = false; console.log(`  MISMATCH at ${i}: got ${JSON.stringify(r)}`); }
});
console.log(`\n${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
