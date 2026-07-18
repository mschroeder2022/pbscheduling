# Pickleball Scheduling Agent — Spec

## Overview
A Discord-bot-based agent that manages scheduling for tournaments, recreational
games, and 1v1/2v1 drilling sessions. It reads an Outlook calendar (via Microsoft
Graph) and cross-checks court reservation status at The Picklr locations.

All events are added to the calendar **manually**; the agent's job is to read them,
classify them, and manage the follow-up checks/reminders — it does not create events.

---

## 1. Event Types

| Type | Reminder | Sign-up/booking check |
|---|---|---|
| Tournament | — | 1 month out: "Have you signed up?" |
| Rec game | 2 hrs before | 1 week out: "Is the court booked?" |
| 1v1 / 2v1 drilling | 2 hrs before | 1 week out: "Is the court booked?" |
| Indoor session @ The Picklr (Scottsdale North / Tempe / Mesa) | 2 hrs before | Automated reservation check, run daily at 7am |

---

## 2. Architecture

- **Hosting:** a Windows machine. The agent runs as a resident Node process launched
  by a logon-triggered Scheduled Task (see `scripts/install-startup.ps1`). It runs in
  the interactive desktop session because the Picklr reservation check uses a **headed**
  browser (a session-0 Windows service has no desktop and cannot render one).
- **Calendar integration:** Microsoft Graph API (`Calendars.Read` scope) via an Azure
  app registration, using the OAuth device-code flow. The refresh token is cached
  locally so the app never re-prompts (see `docs/graph-setup.md`).
- **Scheduler:** `node-cron` jobs:
  - A frequent tick that evaluates per-event reminder/check triggers.
  - A daily 7am job for the Picklr indoor reservation checks.
- **Discord bot:** slash commands for on-demand checks, plus scheduled push messages
  for reminders/checks, with tap-to-confirm buttons.
- **Picklr reservation check:** Playwright (with stealth) logs in and **reads** the
  reservations page for each location. It is strictly **read-only** — a network guard
  aborts any non-GET request to the Picklr domain, so it can never create or modify a
  reservation. Session cookies are cached to minimize logins.

---

## 3. Discord Commands

- `/upcoming` — list the next 7 days of tracked events with sign-up/booking status
- `/status <event>` — status of a specific event (booked / signed up or not)
- `/check-signups` — sign-up/booking status dashboard across all upcoming events
- `/check-picklr` — trigger the read-only Picklr reservation check on demand
- `/ping` — liveness check

---

## 4. Data Model

```
Event {
  id, title, type (tournament | rec_game | drill_1v1 | drill_2v1 | unknown),
  location, isPicklrIndoor (bool), picklrLocation (enum | null),
  startISO,
  signupStatus (unknown | confirmed | not_confirmed),
  bookingStatus (unknown | confirmed | not_confirmed),
  reminderSent (bool),
  weekCheckSent (bool),
  monthCheckSent (bool)
}
```

Event type is inferred from the calendar event **title** (case-insensitive keyword
match on "tournament", "rec", or "drilling"). An event at a Picklr venue with no
keyword defaults to a rec game. `isPicklrIndoor` / `picklrLocation` are inferred from
the event's **location** field matching one of the three Picklr venues.

---

## 5. Design Decisions

1. **Event tagging** — the event title contains "tournament", "rec", or "drilling" as
   a plain keyword; Picklr location is derived from the event's location field.
2. **Picklr login** — automated via a stealth browser that clears the Cloudflare
   managed challenge; no MFA on the accounts. The scraper is **read-only**.
3. **Tournament sign-up confirmation** — manual, via a Discord button/command.
4. **Non-Picklr venues** — always manual booking confirmation (no scraping).
5. **Persistence** — a small JSON store (`.state/events.json`) tracks per-event state.

---

## 6. Build Order

0. Verify Picklr login works and whether MFA is present.
1. Graph API auth + read-only calendar sync.
2. Event classification.
3. Discord bot skeleton + `/upcoming`.
4. Reminder scheduler (2hr / 1wk / 1mo triggers) with manual-confirm buttons.
5. Picklr read-only reservation check + daily 7am job.
6. On-demand commands: `/status`, `/check-signups`, `/check-picklr`.
