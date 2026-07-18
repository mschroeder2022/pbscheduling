// Thin Microsoft Graph client that authenticates each request with our cached token.
require('isomorphic-fetch');
const { Client } = require('@microsoft/microsoft-graph-client');
const { getAccessToken } = require('../auth/graphAuth');

function getGraphClient() {
  return Client.init({
    authProvider: async (done) => {
      try {
        done(null, await getAccessToken());
      } catch (err) {
        done(err, null);
      }
    },
  });
}

module.exports = { getGraphClient };
