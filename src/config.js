// Central config, loaded from .env. Nothing secret is hard-coded here.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const STATE_DIR = path.join(ROOT, '.state');
fs.mkdirSync(STATE_DIR, { recursive: true });

module.exports = {
  ROOT,
  STATE_DIR,

  // --- Microsoft Graph / calendar ---
  // AZURE_CLIENT_ID: from your Azure app registration (see docs/graph-setup.md).
  // AZURE_AUTHORITY: 'consumers' for a personal outlook.com account (default),
  //   'common' if the app also allows work/school accounts.
  graph: {
    // Strip accidental angle-bracket placeholders / quotes / whitespace so a copy
    // like "<guid>" doesn't get sent verbatim.
    clientId: (process.env.AZURE_CLIENT_ID || '').trim().replace(/^[<"']+|[>"']+$/g, ''),
    authority: `https://login.microsoftonline.com/${(process.env.AZURE_AUTHORITY || 'consumers').trim()}`,
    // Read-only for now (step 1). Bump to Calendars.ReadWrite later if the agent
    // ever needs to write events. offline_access => we get a refresh token.
    scopes: (process.env.GRAPH_SCOPES || 'Calendars.Read offline_access User.Read').split(/\s+/),
    calendarAccount: process.env.CALENDAR_ACCOUNT || '',
    tokenCachePath: path.join(STATE_DIR, 'msal-cache.json'),
  },

  // --- Picklr (already working from step 0) ---
  picklr: {
    locations: ['scottsdalenorth', 'tempe', 'mesa'],
    email: process.env.PICKLR_EMAIL || '',
    password: process.env.PICKLR_PASSWORD || '',
  },

  // --- Discord ---
  discord: {
    token: (process.env.DISCORD_BOT_TOKEN || '').trim(),
    guildName: (process.env.DISCORD_GUILD_NAME || 'Hive').trim(),
    channelName: (process.env.DISCORD_CHANNEL_NAME || 'pb-scheduler').trim().replace(/^#/, ''),
    guildId: (process.env.DISCORD_GUILD_ID || '').trim(),
    channelId: (process.env.DISCORD_CHANNEL_ID || '').trim(),
  },

  // How far ahead the calendar sweep looks.
  syncWindowDays: parseInt(process.env.SYNC_WINDOW_DAYS || '35', 10),
};
