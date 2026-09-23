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

// True when a calendar WRITE failed because the cached Microsoft consent only
// covers read scopes (MSAL interaction/consent-required, or Graph 403). Fix is a
// one-time `npm run auth` re-consent that includes Calendars.ReadWrite.
function needsConsent(err) {
  if (!err) return false;
  const code = `${err.errorCode || err.code || ''}`;
  if (/interaction_required|consent_required|invalid_grant|login_required/i.test(code)) return true;
  if (err.name === 'InteractionRequiredAuthError') return true;
  if (err.statusCode === 403 || err.code === 'ErrorAccessDenied') return true;
  const msg = `${err.message || ''} ${err.body || ''}`;
  return /AADSTS65001|AADSTS50076|AADSTS70011|consent|Access is denied|ErrorAccessDenied|interaction_required/i.test(msg);
}

module.exports = { isNoClientId, isNeedsSignIn, isAuthSetupError, needsConsent };
