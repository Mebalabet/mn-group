// Zero-config local-dev storage: files live under uploads/ on disk, same as
// multer's default behavior. Not suitable for most production hosting
// (containers/PaaS typically have ephemeral or non-shared disks — a file
// saved here can vanish on redeploy or not be visible to a second instance)
// — see storage/s3Storage.js for the production path.

const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = {
  kind: 'local',
  uploadDir: UPLOAD_DIR,

  // multer has already written the file to UPLOAD_DIR by the time this
  // runs (see the `upload` middleware in server.js) — this just records
  // where to find it again.
  async save(multerFile) {
    return { fileId: multerFile.filename, originalName: multerFile.originalname, size: multerFile.size };
  },

  // Streams the file straight to the response. Path is built only from the
  // server-generated fileId (never from user input), so there's no
  // traversal risk even without extra sanitization.
  async streamTo(fileId, res) {
    const filePath = path.join(UPLOAD_DIR, fileId);
    if (!filePath.startsWith(UPLOAD_DIR) || !fs.existsSync(filePath)) return false;
    fs.createReadStream(filePath).pipe(res);
    return true;
  },
};
