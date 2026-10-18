'use strict';
// Preloaded with `node -r` by test/sheets-mirror-profile-parity.js: answers the two reads the
// daily parity makes (the Sheet's CSV export and the database REST read) from the JSON file
// named in PARITY_MOCK. Nothing leaves the machine. Synthetic data only.
const fs = require('fs');
const scenario = JSON.parse(fs.readFileSync(process.env.PARITY_MOCK, 'utf8'));
global.fetch = async url => {
  const u = String(url);
  if (u.startsWith('https://docs.google.com/')) {
    const tab = decodeURIComponent((u.match(/[?&]sheet=([^&]+)/) || [])[1] || '');
    return { ok: true, status: 200, text: async () => scenario.sheets[tab] || '' };
  }
  const table = (u.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
  return { ok: true, status: 200, json: async () => scenario.tables[table] || [] };
};
