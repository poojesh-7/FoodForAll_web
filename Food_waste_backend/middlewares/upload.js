const multer = require("multer");
const path = require("path");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = [
    "image/jpeg",
    "image/png",
    "image/jpg",
  ];
  const allowedExtensions = new Set([".jpg", ".jpeg", ".png"]);
  const extension = path.extname(file.originalname || "").toLowerCase();

  if (allowed.includes(file.mimetype) && allowedExtensions.has(extension)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPG, JPEG, PNG allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

module.exports = upload;
