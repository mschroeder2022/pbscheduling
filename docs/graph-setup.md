# Microsoft Graph setup (one-time)

Step 1 needs a Microsoft **Azure app registration** so the agent can read your
Outlook calendar. This is the only manual step — do it once, and the agent caches
a refresh token afterward so it never prompts again (survives reboots).

## 1. Create the app registration
1. Go to <https://portal.azure.com> and sign in with your Microsoft account
   (any account — the registration just issues a client ID).
2. Search **App registrations** → **New registration**.
3. Name: `pbscheduling` (anything).
4. **Supported account types:** choose
   **"Accounts in any organizational directory and personal Microsoft accounts"**
   (personal outlook.com accounts must be allowed).
5. **Redirect URI:** leave blank (we use device-code flow, no redirect needed).
6. Click **Register**.

## 2. Allow the public/device-code flow  ← REQUIRED, easy to miss
1. In the app → **Authentication**.
2. Scroll to **Advanced settings** → **Allow public client flows** → set to **Yes**. **Save.**
3. If you skip this, sign-in fails with `AADSTS70002: The client application must be
   marked as 'mobile.'` — that error means this toggle is still Off.

## 3. (Delegated) permissions
1. App → **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Delegated permissions**.
2. Add: **Calendars.ReadWrite**, **offline_access**, **User.Read**.
   - Reads (sync, `/upcoming`, ...) only use `Calendars.Read`.
   - `Calendars.ReadWrite` is used for exactly one thing: when you tap
     **➕ Add to calendar** on a Discord alert about a Picklr reservation that isn't
     on your calendar, the agent creates that Outlook event. It never writes
     otherwise. (`GRAPH_WRITE_SCOPES` in `.env`; see "Upgrading to write access" below.)
3. Admin consent is **not** required for personal-account delegated scopes — you'll
   consent yourself during first sign-in.

## 4. Copy the Client ID into .env
1. App → **Overview** → copy **Application (client) ID**.
2. In the project `.env` (paste the GUID with **no angle brackets, no quotes**):
   ```
   AZURE_CLIENT_ID=your-application-client-id
   AZURE_AUTHORITY=consumers
   ```
   Use `consumers` for a personal outlook.com account. If you chose the multi-tenant
   option and want it to also work with work/school accounts, use `common`.

## 5. One-time sign-in
```
node scripts/graph-auth.js
```
It prints a URL (<https://microsoft.com/devicelogin>) and a code. Open it on any
device, sign in with your Microsoft account, approve the calendar-read consent.
The refresh token is cached to `.state/msal-cache.json`.

## 6. Verify calendar sync
```
node scripts/sync-calendar.js
```
Prints the next 35 days of events, each classified by type (tournament / rec_game /
drill / unknown) and flagged if it maps to a Picklr venue.

After this, the resident agent (`npm start`, or the auto-start scheduled task) will
sync on boot and daily without any further prompts.

## Upgrading to write access (orphan-reservation approvals)
If you signed in before the "Add to calendar" feature existed, the cached consent is
read-only. Reads keep working. The first time you tap **➕ Add to calendar** in
Discord, the bot replies "sign-in only has read access" and leaves the buttons in place.
To fix, once, on the agent box:
```
npm run auth
```
Sign in with the same device-code flow and approve the calendar **read and write**
consent. Then tap the button again — no restart needed.

## Troubleshooting
- **`AADSTS70002 ... must be marked as 'mobile'`** → "Allow public client flows" is
  still Off. Fix in step 2 above, Save, wait ~30s, retry.
- **Sign-in prints `undefined` for the code** → the client ID in `.env` was pasted
  with angle brackets/quotes. It must be a bare GUID (config now strips these, but
  keep `.env` clean).
- **Quick check that the app is configured right** (does NOT complete sign-in — just
  confirms the endpoint accepts the client ID):
  ```powershell
  $body = @{ client_id = (Select-String '^AZURE_CLIENT_ID=' .env).Line.Split('=')[1]; scope = 'Calendars.Read offline_access User.Read' }
  Invoke-RestMethod -Method Post -Uri 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode' -Body $body -ContentType 'application/x-www-form-urlencoded'
  ```
  A `user_code` + `verification_uri` in the response = configured correctly, go run
  `node scripts/graph-auth.js`. An `invalid_client` error = revisit step 2.
