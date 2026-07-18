// Safety test: prove the read-only guard blocks any mutating (non-GET) request to
// Picklr after login, so the agent can NEVER create/modify a reservation.
const { openReservations } = require('../src/picklr/browser');

(async () => {
  const loc = 'scottsdalenorth';
  const { context, page } = await openReservations(loc);
  try {
    // Attempt a POST (what a booking/mutation would use). The guard must abort it.
    const post = await page.evaluate(async (url) => {
      try { const r = await fetch(url, { method: 'POST', body: 'x' }); return { ok: true, status: r.status }; }
      catch (e) { return { ok: false, error: String(e) }; }
    }, `https://${loc}.thepicklr.com/account/reservations`);

    // A GET should still work (reading is allowed).
    const get = await page.evaluate(async (url) => {
      try { const r = await fetch(url, { method: 'GET' }); return { ok: true, status: r.status }; }
      catch (e) { return { ok: false, error: String(e) }; }
    }, `https://${loc}.thepicklr.com/account/reservations`);

    const postBlocked = post.ok === false; // fetch rejects when the request is aborted
    const getWorked = get.ok === true;
    console.log(`POST attempt: ${JSON.stringify(post)}  -> ${postBlocked ? 'BLOCKED ✅' : 'NOT blocked ❌'}`);
    console.log(`GET  attempt: ${JSON.stringify(get)}  -> ${getWorked ? 'allowed ✅' : 'blocked ❌'}`);
    const pass = postBlocked && getWorked;
    console.log(`\n${pass ? 'PASS — mutations blocked, reads allowed' : 'FAIL — guard not behaving as required'}`);
    process.exitCode = pass ? 0 : 1;
  } finally {
    await context.close();
  }
})();
