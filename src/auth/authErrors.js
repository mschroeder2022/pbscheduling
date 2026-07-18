// Helpers to recognize "not set up yet" auth states, even after the Graph client
// wraps the original error into a GraphError (which drops our .code).
function isNoClientId(err) {
  if (!err) return false;
  if (err.code === 'NO_CLIENT_ID') return true;
  const msg = `${err.message || ''} ${err.body || ''}`;
  return /AZURE_CLIENT_ID is not set/i.test(msg);
}

function isNeedsSignIn(err) {
  if (!err) return false;
  if (err.code === 'NEEDS_INTERACTIVE_SIGN_IN') return true;
  const msg = `${err.message || ''} ${err.body || ''}`;
  return /No cached Microsoft account/i.test(msg);
}

function isAuthSetupError(err) {
  return isNoClientId(err) || isNeedsSignIn(err);
}

module.exports = { isNoClientId, isNeedsSignIn, isAuthSetupError };
