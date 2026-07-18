// One-time interactive Microsoft sign-in (device-code flow).
// Run once: `node scripts/graph-auth.js`. Follow the printed URL + code, sign in
// as the calendar account. The refresh token is cached so the app never prompts
// again (survives reboots).
const { signInInteractive, getSignedInUsername } = require('../src/auth/graphAuth');
const { graph } = require('../src/config');

(async () => {
  if (!graph.clientId) {
    console.error('\nAZURE_CLIENT_ID is not set in .env.');
    console.error('Create an Azure app registration first — see docs/graph-setup.md.\n');
    process.exit(1);
  }
  try {
    console.log(`Signing in for calendar account: ${graph.calendarAccount}`);
    console.log(`Authority: ${graph.authority}`);
    console.log(`Scopes: ${graph.scopes.join(', ')}`);
    const result = await signInInteractive();
    console.log(`\nSuccess. Signed in as: ${result.account && result.account.username}`);
    console.log('Refresh token cached to .state/msal-cache.json — the app will not prompt again.');
    console.log(`getSignedInUsername() now returns: ${await getSignedInUsername()}`);
  } catch (err) {
    console.error('\nSign-in failed:', err.message || err);
    if (err.code === 'NO_CLIENT_ID') console.error('Set AZURE_CLIENT_ID in .env.');
    process.exit(1);
  }
})();
