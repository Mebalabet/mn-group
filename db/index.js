// Picks the database backend at startup: Postgres if DATABASE_URL is set
// (the production path), the local JSON file otherwise (zero-config local
// dev). `pg` is only require()'d when actually needed, so running without
// DATABASE_URL never needs it installed.

const config = require('../config');

const store = config.databaseUrl
  ? require('./pgStore')
  : require('./jsonStore');

if (config.databaseUrl) {
  console.log('[db] using Postgres (DATABASE_URL is set)');
} else {
  console.log('[db] using local JSON file at data/db.json — set DATABASE_URL for production');
}

module.exports = store;
