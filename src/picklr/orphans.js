// Reverse-direction check: find Picklr reservations that have NO matching Outlook
// calendar event ("orphans"), so a booked court never goes unnoticed. The forward
// check (match.js) asks "is this event's court booked?"; this asks "is this booked
// court on the calendar?".
//
// A reservation is an orphan when it is Booked, starts in the future, falls inside
// the calendar sync window (beyond that we can't know what's on the calendar), and
// no tracked event shares its date with a start time within the tolerance. Matching
// is against ALL tracked events — not just Picklr-classified ones — so an event
// whose location string didn't map to a Picklr venue still counts as covered.
//
// Each orphan is alerted in Discord ONCE with two buttons: "Add to calendar" (the
// agent creates the Outlook event) or "Don't add" (never asked again). The alert
// record persists in .state/orphan-alerts.json with status pending|added|ignored,
// keyed by a short hash of loc/date/time/court so Discord button ids stay short.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STATE_DIR, syncWindowDays } = require('../config');
const { eventDateAndMinutes } = require('./match');

const ALERTS_PATH = path.join(STATE_DIR, 'orphan-alerts.json');
const DAY = 86400000;

function resMinutes(r) {
  const m = (r.startTime || '').match(/^(\d{2}):(\d{2})$/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

// Reservation start as an absolute instant (dateISO/startTime are Phoenix-local).
function resStartMs(r) {
  return new Date(`${r.dateISO}T${r.startTime}:00-07:00`).getTime();
}

function orphanKey(location, r) {
  return `${location}|${r.dateISO}|${r.startTime}|c${r.court}`;
}

// Short stable id for Discord customIds (capped at 100 chars).
function orphanShortId(key) {
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
}

// scans: { <loc>: { ok, reservations } } (shape of scraper.checkAll).
// trackedEvents: store.all(). Returns [{ location, reservation, key, shortId, startMs }].
function findOrphanReservations(scans, trackedEvents, nowMs = Date.now(),
  windowDays = syncWindowDays, toleranceMin = 60) {
  const evTimes = trackedEvents.map(eventDateAndMinutes).filter(Boolean);
  const orphans = [];
  for (const [location, scan] of Object.entries(scans || {})) {
    if (!scan || !scan.ok) continue; // a failed scrape proves nothing — no alarm
    for (const r of scan.reservations) {
      if (!/booked/i.test(r.status || '')) continue;
      const rm = resMinutes(r);
      if (rm == null || !r.dateISO) continue;
      const startMs = resStartMs(r);
      if (startMs < nowMs || startMs > nowMs + windowDays * DAY) continue;
      const covered = evTimes.some(ev =>
        ev.dateISO === r.dateISO && Math.abs(ev.minutes - rm) <= toleranceMin);
      if (!covered) {
        const key = orphanKey(location, r);
        orphans.push({ location, reservation: r, key, shortId: orphanShortId(key), startMs });
      }
    }
  }
  return orphans.sort((a, b) => a.startMs - b.startMs);
}

// --- Alert records: each orphan is pushed to Discord once, then tracked by status.
//   pending  — alerted, waiting for the user to tap Add / Don't add
//   added    — user approved; the Outlook event was created (eventId recorded)
//   ignored  — user declined; never alerted again, never added
// If the user adds the event themselves, it simply stops being an orphan. On-demand
// /check-picklr re-shows pending orphans (with buttons) and lists ignored ones.

function loadAlerts() {
  try { return JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8')); } catch { return {}; }
}

function saveAlerts(alerts, nowMs = Date.now()) {
  // Prune entries whose reservation is comfortably past so the file doesn't grow.
  for (const [key, v] of Object.entries(alerts)) {
    if (!v || !v.startMs || v.startMs < nowMs - 2 * DAY) delete alerts[key];
  }
  fs.writeFileSync(ALERTS_PATH, JSON.stringify(alerts, null, 2));
}

// Strip parser scratch fields before persisting.
function cleanReservation(r) {
  const { _sh, _sm, ...rest } = r || {};
  return rest;
}

function getAlertByKey(key) {
  return loadAlerts()[key] || null;
}

// Alert record for an orphan (null if never alerted). Legacy records written before
// the approve flow (no `status`) are treated as never alerted so they get re-sent
// once WITH buttons.
function alertFor(orphan) {
  const rec = getAlertByKey(orphan.key);
  return rec && rec.status ? rec : null;
}

// Orphans that still need a first alert (never alerted, or legacy record).
function filterUnalerted(orphans) {
  return orphans.filter(o => !alertFor(o));
}

// Record that these orphans were alerted (status pending). Never downgrades an
// existing added/ignored record.
function markAlerted(orphans, nowMs = Date.now()) {
  const alerts = loadAlerts();
  for (const o of orphans) {
    const prev = alerts[o.key];
    if (prev && prev.status && prev.status !== 'pending') continue;
    alerts[o.key] = {
      shortId: o.shortId || orphanShortId(o.key),
      location: o.location,
      reservation: cleanReservation(o.reservation),
      startMs: o.startMs,
      alertedAt: (prev && prev.alertedAt) || nowMs,
      status: 'pending',
    };
  }
  saveAlerts(alerts, nowMs);
}

// Look up a pending/added/ignored alert by its Discord shortId.
function getAlert(shortId) {
  for (const [key, rec] of Object.entries(loadAlerts())) {
    if (rec && (rec.shortId === shortId || orphanShortId(key) === shortId)) return { key, ...rec };
  }
  return null;
}

// Transition an alert: 'added' (with eventId) or 'ignored'. Returns the record.
function setAlertStatus(shortId, status, extra = {}, nowMs = Date.now()) {
  const alerts = loadAlerts();
  const key = Object.keys(alerts).find(k => alerts[k] && (alerts[k].shortId === shortId || orphanShortId(k) === shortId));
  if (!key) return null;
  alerts[key] = { ...alerts[key], ...extra, status, decidedAt: nowMs };
  saveAlerts(alerts, nowMs);
  return { key, ...alerts[key] };
}

module.exports = {
  findOrphanReservations, filterUnalerted, markAlerted, alertFor, getAlert, setAlertStatus,
  orphanKey, orphanShortId, ALERTS_PATH,
};
