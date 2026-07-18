# pbscheduling — Pickleball Scheduling Agent

Reads your Outlook calendar, classifies pickleball events, and manages
sign-up/booking reminders + Picklr indoor-court reservation checks. See
`SPEC.md` for the full spec.

## Status
- **Step 0 — Picklr login / MFA check:** ✅ DONE. Fully automated login works, no MFA.
  Cloudflare Managed Challenge is auto-passed via `playwright-extra` stealth.
  (`scripts/auto-login.js`)
- **Step 1 — Graph auth + read-only calendar sync:** ✅ DONE & live. Reads the real
  calendar and classifies events. (`docs/graph-setup.md`)
- **Step 3 — Discord bot + `/upcoming`:** ✅ DONE. Bot posts to **#pb-scheduler** in
  **The Hive**; slash commands `/upcoming` and `/ping`. (`src/discord/`)
- **Startup persistence:** ✅ Registered as a logon scheduled task
  (`scripts/install-startup.ps1`).
- **Step 2 — classification:** ✅ DONE. Picklr-venue events without a keyword default
  to rec games so they still get booking checks.
- **Step 4 — reminder scheduler:** ✅ DONE. 2hr-before reminders, 1-week booking
  checks, 1-month tournament signup checks, with tap-to-confirm buttons in Discord.
  State persists in `.state/events.json`. (`src/scheduler/`)
- **Step 5 — Picklr reservation check + 7am job:** ✅ DONE. READ-ONLY scrape of the
  reservations page, auto-confirms booking status, daily 7am digest. Picklr booking
  checks are automated (no manual button). (`src/picklr/`)
- **Step 6 — on-demand commands:** ✅ DONE. `/status`, `/check-signups`,
  `/check-picklr` (plus `/upcoming`, `/ping`).
- **All build steps (0–6) complete.**

## Setup
1. `npm install` (already done in this checkout)
2. Copy `.env.example` → `.env` and fill in credentials.
   - Picklr: `PICKLR_EMAIL` / `PICKLR_PASSWORD` (already set).
   - Graph: `AZURE_CLIENT_ID` (+ `AZURE_AUTHORITY`) — see `docs/graph-setup.md`.
3. One-time Microsoft sign-in: `npm run auth`
4. Verify calendar read: `npm run sync`

## Run
- Foreground (dev): `npm start`  → resident process, logs to `logs/agent.log`.
- Auto-start at logon (recommended):
  ```
  powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
  ```
  Uninstall: `scripts\uninstall-startup.ps1`.

## Auto-start design (why a logon task, not a service)
The Picklr scraper must use **headed** Chrome (Cloudflare blocks headless). Headed
Chrome needs a desktop session, which a session-0 Windows service does not have.
So the agent runs as a **logon-triggered scheduled task** in the interactive
session, launched hidden via `scripts/launch-hidden.vbs`, auto-restarting on crash.

For a fully unattended start after a reboot with nobody at the keyboard, enable
Windows **auto-logon** so the desktop session starts on boot (that's the piece that
lets the logon task fire). Without auto-logon, the agent starts the moment you log in.

## Scripts
| Command | What it does |
|---|---|
| `npm start` | Run the resident agent (calendar sweep + schedulers). |
| `npm run auth` | One-time Microsoft device-code sign-in. |
| `npm run sync` | Print the upcoming classified calendar events. |
| `node scripts/test-discord.js` | Verify the bot connects and can post to #pb-scheduler. |
| `node scripts/test-triggers.js` | Unit-test the reminder trigger windows (no I/O). |
| `node scripts/test-reminders-dryrun.js` | Show what reminders would fire now (no sending). |
| `node scripts/show-store.js` | Dump the tracked-event state (`.state/events.json`). |
| `node scripts/check-picklr.js [days]` | Live READ-ONLY Picklr reservation check + match. |
| `node scripts/test-parse.js` | Test the reservations parser against captured HTML. |
| `node scripts/test-readonly-guard.js` | Prove the guard blocks writes (POST) but allows reads. |
| `node scripts/auto-login.js <loc>` | Picklr automated login for scottsdalenorth\|tempe\|mesa. |
| `node scripts/diagnose-cf.js <loc>` | Classify the Cloudflare challenge (debug). |

## Logs
`logs/agent.log` — startup, daily sweeps, heartbeats, errors. Check here after an
unattended reboot to confirm the agent came up.
