const crypto = require("crypto");

const allowedSignatures = [
  { mime: "image/jpeg", matches: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 },
  {
    mime: "image/png",
    matches: (buffer) =>
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a,
  },
];

function assertSafeImageBuffer(buffer, mimetype) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Uploaded file is empty");
  }

  const signature = allowedSignatures.find((item) => item.mime === mimetype);
  if (!signature || !signature.matches(buffer)) {
    throw new Error("Uploaded file content does not match its image type");
  }
}

function signUploadParams(params) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(`${payload}${process.env.CLOUDINARY_API_SECRET}`)
    .digest("hex");
}

async function uploadBuffer(buffer, options = {}) {
  const { mimetype, ...cloudinaryOptions } = options;
  assertSafeImageBuffer(buffer, mimetype);

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const params = {
    allowed_formats: "jpg,jpeg,png",
    folder: cloudinaryOptions.folder,
    invalidate: cloudinaryOptions.invalidate ? "true" : undefined,
    overwrite: cloudinaryOptions.overwrite ? "true" : undefined,
    public_id: cloudinaryOptions.public_id,
    timestamp: Math.floor(Date.now() / 1000),
  };
  const formData = new FormData();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(key, String(value));
    }
  });

  formData.append("api_key", process.env.CLOUDINARY_API_KEY);
  formData.append("signature", signUploadParams(params));
  formData.append("file", new Blob([buffer], { type: mimetype }), "upload");

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: "POST", body: formData }
  );
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result?.error?.message || "Cloudinary upload failed");
  }

  return result;
}

module.exports = {
  assertSafeImageBuffer,
  uploadBuffer,
};
