const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/fssai/");
  },
  filename: (req, file, cb) => {
    const fssai = req.body.fssai_number;
    const ext = file.mimetype.split("/")[1];

    const filename = `${fssai}_${req.user.id}.${ext}`;

    cb(null, filename);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/jpg"];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only images allowed"), false);
};

const upload = multer({ storage, fileFilter });

module.exports = upload;
