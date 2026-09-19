// Picks the storage backend at startup: S3-compatible object storage if
// S3_BUCKET is set (the production path), local disk otherwise.
// @aws-sdk/client-s3 is only require()'d when actually needed.

const config = require('../config');

const storage = config.storage.bucket
  ? require('./s3Storage')
  : require('./localStorage');

if (config.storage.bucket) {
  console.log(`[storage] using S3-compatible storage (bucket: ${config.storage.bucket})`);
} else {
  console.log('[storage] using local disk at uploads/ — set S3_BUCKET for production');
}

module.exports = storage;
