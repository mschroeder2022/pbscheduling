// Thin Microsoft Graph client that authenticates each request with our cached token.
// getGraphClient() => read scopes (default). getGraphClient({ write: true }) => write
// scopes (Calendars.ReadWrite), used only for user-approved event creation.
require('isomorphic-fetch');
const { Client } = require('@microsoft/microsoft-graph-client');
const { getAccessToken } = require('../auth/graphAuth');
const { graph } = require('../config');

function getGraphClient({ write = false } = {}) {
  const scopes = write ? graph.writeScopes : graph.scopes;
  return Client.init({
    authProvider: async (done) => {
      try {
        done(null, await getAccessToken(scopes));
      } catch (err) {
        done(err, null);
      }
    },
  });
}

module.exports = { getGraphClient };
