// Recon: log in read-only and dump the reservations DOM so we can build a parser.
const fs = require('fs');
const path = require('path');
const { openReservations } = require('../src/picklr/browser');

(async () => {
  const loc = (process.argv[2] || 'scottsdalenorth').toLowerCase();
  const outDir = path.join(__dirname, '..', 'recon-out');
  fs.mkdirSync(outDir, { recursive: true });
  const { context, page } = await openReservations(loc);
  try {
    const innerText = await page.evaluate(() => document.body.innerText);
    // Grab candidate reservation-card HTML: any element whose text has a time range.
    const cards = await page.evaluate(() => {
      const out = [];
      const timeRe = /\d{1,2}:\d{2}\s*(AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)/i;
      const els = Array.from(document.querySelectorAll('div,li,article,section'));
      for (const el of els) {
        const t = el.innerText || '';
        // Smallest elements that still contain a full time range + a date-ish token.
        if (timeRe.test(t) && /\b(Court|Booked|Reserved|Paid)\b/i.test(t) && t.length < 600) {
          const childHasRange = Array.from(el.children).some(c => timeRe.test(c.innerText || ''));
          if (!childHasRange) out.push({ text: t.replace(/\n+/g, ' | ').trim(), html: el.outerHTML.slice(0, 1500) });
        }
      }
      return out.slice(0, 20);
    });
    fs.writeFileSync(path.join(outDir, `${loc}-reservations.txt`),
      `URL: ${page.url()}\n\n===== innerText =====\n${innerText}\n\n===== CARD CANDIDATES (${cards.length}) =====\n` +
      cards.map((c, i) => `--- card ${i} ---\nTEXT: ${c.text}\nHTML: ${c.html}\n`).join('\n'));
    console.log(`URL: ${page.url()}`);
    console.log(`Found ${cards.length} card candidate(s). Wrote recon-out/${loc}-reservations.txt`);
    console.log('\n--- first 3 card texts ---');
    cards.slice(0, 3).forEach((c, i) => console.log(`[${i}] ${c.text}`));
  } finally {
    await context.close();
  }
})();
