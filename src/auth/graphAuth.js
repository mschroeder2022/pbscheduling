// Microsoft Graph auth via MSAL device-code flow, with a persistent token cache
// so the refresh token survives restarts/reboots and we never re-prompt after the
// first interactive sign-in.
//
//  - signInInteractive(): run ONCE (scripts/graph-auth.js). Prints a URL + code;
//    you sign in on any device. Refresh token is cached to .state/msal-cache.json.
//  - getAccessToken(): used by the app. Silently uses the cached account + refresh
//    token. Throws NEEDS_INTERACTIVE_SIGN_IN if no cached account exists yet.
const fs = require('fs');
const { PublicClientApplication, LogLevel } = require('@azure/msal-node');
const { graph } = require('../config');

if (!graph.clientId) {
  // Not fatal at require-time; surfaced clearly when auth is actually attempted.
}

// Persist the MSAL token cache to disk (contains the refresh token).
const cachePlugin = {
  beforeCacheAccess: async (ctx) => {
    try {
      if (fs.existsSync(graph.tokenCachePath)) {
        ctx.tokenCache.deserialize(fs.readFileSync(graph.tokenCachePath, 'utf8'));
      }
    } catch { /* start empty */ }
  },
  afterCacheAccess: async (ctx) => {
    if (ctx.cacheHasChanged) {
      fs.writeFileSync(graph.tokenCachePath, ctx.tokenCache.serialize(), { mode: 0o600 });
    }
  },
};

function buildPca() {
  if (!graph.clientId) {
    const e = new Error('AZURE_CLIENT_ID is not set. See docs/graph-setup.md.');
    e.code = 'NO_CLIENT_ID';
    throw e;
  }
  return new PublicClientApplication({
    auth: { clientId: graph.clientId, authority: graph.authority },
    cache: { cachePlugin },
    system: {
      loggerOptions: {
        loggerCallback: () => {},
        piiLoggingEnabled: false,
        logLevel: LogLevel.Warning,
      },
    },
  });
}

async function getCachedAccount(pca) {
  const accounts = await pca.getTokenCache().getAllAccounts();
  if (!accounts.length) return null;
  // Prefer the configured calendar account if present.
  return accounts.find(a => (a.username || '').toLowerCase() === graph.calendarAccount.toLowerCase())
    || accounts[0];
}

// One-time interactive device-code sign-in.
async function signInInteractive() {
  const pca = buildPca();
  const result = await pca.acquireTokenByDeviceCode({
    scopes: graph.scopes,
    deviceCodeCallback: (info) => {
      console.log('\n==================== SIGN IN ====================');
      if (info && info.message) {
        console.log(info.message); // "go to https://microsoft.com/devicelogin and enter CODE ABC-DEF"
      }
      // Print the pieces explicitly too, in case `message` is empty for some tenants.
      if (info && (info.userCode || info.verificationUri)) {
        console.log(`  URL:  ${info.verificationUri || 'https://microsoft.com/devicelogin'}`);
        console.log(`  CODE: ${info.userCode || '(none returned)'}`);
      }
      console.log('================================================\n');
    },
  });
  return result;
}

// Silent token for the app. Refreshes automatically via the cached refresh token.
async function getAccessToken() {
  const pca = buildPca();
  const account = await getCachedAccount(pca);
  if (!account) {
    const e = new Error('No cached Microsoft account. Run: node scripts/graph-auth.js');
    e.code = 'NEEDS_INTERACTIVE_SIGN_IN';
    throw e;
  }
  const result = await pca.acquireTokenSilent({ account, scopes: graph.scopes });
  return result.accessToken;
}

async function getSignedInUsername() {
  const pca = buildPca();
  const account = await getCachedAccount(pca);
  return account ? account.username : null;
}

module.exports = { signInInteractive, getAccessToken, getSignedInUsername };
