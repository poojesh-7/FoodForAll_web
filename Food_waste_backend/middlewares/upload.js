const multer = require("multer");
const path = require("path");

const storage = multer.memoryStorage();
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);

const DEFAULT_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/jpg"];
const DEFAULT_ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png"];
const FSSAI_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/jpg", "application/pdf"];
const FSSAI_ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".pdf"];
const REPORT_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const REPORT_ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

function createImageUpload({
  allowedMimeTypes = DEFAULT_ALLOWED_MIME_TYPES,
  allowedExtensions = DEFAULT_ALLOWED_EXTENSIONS,
  errorMessage = "Only JPG, JPEG, PNG allowed",
  maxFiles = 1,
} = {}) {
  const allowedExtensionSet = new Set(allowedExtensions);

  const fileFilter = (req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();

    if (
      allowedMimeTypes.includes(file.mimetype) &&
      allowedExtensionSet.has(extension)
    ) {
      cb(null, true);
    } else {
      cb(new Error(errorMessage), false);
    }
  };

  return multer({
    storage,
    fileFilter,
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: maxFiles,
      fields: 20,
      parts: 20 + maxFiles,
    },
  });
}

const upload = createImageUpload();

upload.fssaiCertificate = createImageUpload({
  allowedMimeTypes: FSSAI_ALLOWED_MIME_TYPES,
  allowedExtensions: FSSAI_ALLOWED_EXTENSIONS,
  errorMessage: "Only JPG, JPEG, PNG, or PDF FSSAI certificates allowed",
});

upload.providerReportAttachments = createImageUpload({
  allowedMimeTypes: REPORT_ALLOWED_MIME_TYPES,
  allowedExtensions: REPORT_ALLOWED_EXTENSIONS,
  errorMessage: "Only JPG, JPEG, PNG, or WEBP images allowed",
  maxFiles: 3,
});

upload.MAX_UPLOAD_BYTES = MAX_UPLOAD_BYTES;
upload.FSSAI_ALLOWED_MIME_TYPES = FSSAI_ALLOWED_MIME_TYPES;
upload.REPORT_ALLOWED_MIME_TYPES = REPORT_ALLOWED_MIME_TYPES;

module.exports = upload;
