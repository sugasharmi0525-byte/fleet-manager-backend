const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const env = require('../config/env');
const { HttpError } = require('./errorHandler');

const MAX_BYTES = 5 * 1024 * 1024;

fs.mkdirSync(env.uploadDir, { recursive: true });

// Server-generated names only; the client's file name is never used on disk.
const storage = multer.diskStorage({
  destination: env.uploadDir,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.fieldname}_${crypto.randomBytes(6).toString('hex')}.pdf`);
  },
});

function pdfOnly(req, file, cb) {
  const isPdf = file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf';
  cb(isPdf ? null : new HttpError(400, `${file.fieldname}: only PDF files are allowed`), isPdf);
}

// The browser-supplied type can lie, so check the saved file really starts with "%PDF".
function verifyPdfSignature(req, res, next) {
  const files = Object.values(req.files || {}).flat();
  for (const file of files) {
    const fd = fs.openSync(file.path, 'r');
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    if (head.toString('latin1') !== '%PDF') {
      files.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
      return next(new HttpError(400, `${file.fieldname}: the file is not a valid PDF`));
    }
  }
  next();
}

/**
 * Accepts up to one PDF per named field, e.g. pdfUpload(['fc_pdf', 'ins_pdf', 'pol_pdf']).
 * Saved files are available as req.files[field][0].filename.
 */
function pdfUpload(fields) {
  const upload = multer({
    storage,
    fileFilter: pdfOnly,
    limits: { fileSize: MAX_BYTES, files: fields.length, fields: 50 },
  }).fields(fields.map((name) => ({ name, maxCount: 1 })));
  return [upload, verifyPdfSignature];
}

/** Path stored in the database for an uploaded file ("uploads/<name>", as the PHP app did). */
const storedPath = (file) => `uploads/${file.filename}`;

module.exports = { pdfUpload, storedPath };
