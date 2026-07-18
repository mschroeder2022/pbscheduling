// Dry run: fetch the REAL calendar, update the store, evaluate triggers, and print
// what WOULD be sent — without posting to Discord and without marking anything sent.
const { fetchUpcomingEvents } = require('../src/calendar/sync');
const { upsertFromCalendar, all } = require('../src/scheduler/store');
const { evaluateEvent } = require('../src/scheduler/triggers');
const { build } = require('../src/scheduler/messages');

(async () => {
  const events = await fetchUpcomingEvents();
  upsertFromCalendar(events);
  const now = Date.now();
  console.log(`Now: ${new Date(now).toISOString()} (Phoenix ${new Date(now - 7 * 3600000).toISOString().slice(0, 16).replace('T', ' ')})\n`);

  let count = 0;
  for (const t of all()) {
    const actions = evaluateEvent(t, now);
    if (!actions.length) continue;
    for (const a of actions) {
      count++;
      const payload = build(a.kind, t);
      const btns = payload.components.length
        ? payload.components[0].components.map(c => c.data.label).join(' | ')
        : '(no buttons)';
      console.log(`WOULD SEND [${a.kind}] for "${t.title}" (${t.type})`);
      console.log(`  ${payload.content.replace(/\n/g, '\n  ')}`);
      console.log(`  buttons: ${btns}\n`);
    }
  }
  console.log(count ? `\n${count} message(s) would fire on the next real tick.`
                    : '\nNothing would fire right now.');
})();
