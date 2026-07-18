// Persistent tracking state for events (survives restarts). Keyed by Graph event id.
// Small volume (a handful of events) => a plain JSON file is simpler and more
// debuggable than a database.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { STATE_DIR } = require('../config');

const STORE_PATH = path.join(STATE_DIR, 'events.json');

function shortIdOf(eventId) {
  // Discord customId is capped at 100 chars and Graph ids are long, so we key
  // buttons by a short stable hash of the event id.
  return crypto.createHash('sha1').update(eventId).digest('hex').slice(0, 12);
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

// Merge freshly-synced calendar events into the store, preserving tracking flags.
// If an event's start time changed, reset the sent flags so checks re-fire.
function upsertFromCalendar(events) {
  const data = load();
  const seen = new Set();
  for (const e of events) {
    if (!e.id) continue;
    seen.add(e.id);
    const prev = data[e.id];
    const startISO = e.startRaw && e.startRaw.dateTime ? e.startRaw.dateTime : null;
    const startChanged = prev && prev.startISO !== startISO;

    data[e.id] = {
      id: e.id,
      shortId: shortIdOf(e.id),
      title: e.title,
      type: e.type,
      typeInferredFromVenue: !!e.typeInferredFromVenue,
      location: e.location,
      isPicklrIndoor: !!e.isPicklrIndoor,
      picklrLocation: e.picklrLocation || null,
      reservationUrl: e.reservationUrl || null,
      startISO,
      timeZone: (e.startRaw && e.startRaw.timeZone) || null,
      // Tracking state (preserved unless the start moved):
      signupStatus: prev && !startChanged ? prev.signupStatus : 'unknown',
      bookingStatus: prev && !startChanged ? prev.bookingStatus : 'unknown',
      reminderSent: prev && !startChanged ? !!prev.reminderSent : false,
      weekCheckSent: prev && !startChanged ? !!prev.weekCheckSent : false,
      monthCheckSent: prev && !startChanged ? !!prev.monthCheckSent : false,
    };
  }

  // Prune events that dropped out of the sync window AND are in the past, so the
  // store doesn't grow forever. Keep still-tracked (future) ones even if not seen.
  const now = Date.now();
  for (const id of Object.keys(data)) {
    if (seen.has(id)) continue;
    const startISO = data[id].startISO;
    const started = startISO ? new Date(`${cleanIso(startISO)}-07:00`).getTime() : 0;
    if (!startISO || started < now - 2 * 86400000) delete data[id];
  }

  save(data);
  return data;
}

// Graph dateTime looks like "2026-07-20T16:00:00.0000000"; strip fractional secs.
function cleanIso(dt) {
  return dt.replace(/(\.\d+)?$/, '');
}

function all() {
  return Object.values(load());
}

function get(id) {
  return load()[id] || null;
}

function findByShortId(shortId) {
  return all().find(e => e.shortId === shortId) || null;
}

function update(id, patch) {
  const data = load();
  if (!data[id]) return null;
  data[id] = { ...data[id], ...patch };
  save(data);
  return data[id];
}

module.exports = {
  STORE_PATH, shortIdOf, load, save, upsertFromCalendar, all, get, findByShortId, update, cleanIso,
};
