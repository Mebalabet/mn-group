// Production file storage: any S3-compatible provider works here — real AWS
// S3, or Cloudflare R2 / Backblaze B2 / DigitalOcean Spaces (all speak the
// same API; only the endpoint/credentials differ). Selected automatically
// when S3_BUCKET is set — see config.js and storage/index.js.
//
// Requires the file to arrive as a memory buffer (req.file.buffer), so
// server.js switches multer to memoryStorage when this adapter is active —
// diskStorage (the local-dev default) doesn't populate .buffer.

const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const config = require('../config');

let client = null;
function getClient() {
  if (client) return client;
  client = new S3Client({
    region: config.storage.region,
    endpoint: config.storage.endpoint || undefined, // omit for real AWS S3; required for R2/B2/Spaces
    forcePathStyle: !!config.storage.endpoint, // most S3-compatible providers need path-style addressing
    credentials: {
      accessKeyId: config.storage.accessKeyId,
      secretAccessKey: config.storage.secretAccessKey,
    },
  });
  return client;
}

module.exports = {
  kind: 's3',

  async save(multerFile) {
    if (!multerFile.buffer) {
      throw new Error('S3 storage requires multer memoryStorage — got a disk-based file instead');
    }
    const ext = path.extname(multerFile.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
    const fileId = crypto.randomBytes(16).toString('hex') + ext;
    await getClient().send(new PutObjectCommand({
      Bucket: config.storage.bucket,
      Key: fileId,
      Body: multerFile.buffer,
      ContentType: multerFile.mimetype || 'application/octet-stream',
    }));
    return { fileId, originalName: multerFile.originalname, size: multerFile.size };
  },

  async streamTo(fileId, res) {
    try {
      const obj = await getClient().send(new GetObjectCommand({ Bucket: config.storage.bucket, Key: fileId }));
      obj.Body.pipe(res);
      return true;
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  },
};
