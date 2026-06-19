const crypto = require("crypto");
const { deleteResource, uploadBuffer } = require("./cloudinary.service");

async function uploadProfileImage(userId, file) {
  const storagePrefix = process.env.ENV_RESOURCE_PREFIX || process.env.APP_ENV || "local";
  const nonce =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString("hex");

  const uploaded = await uploadBuffer(file.buffer, {
    folder: `food-rescue/${storagePrefix}/profiles/${userId}`,
    public_id: `profile_${userId}_${nonce}`,
    overwrite: false,
    invalidate: true,
    mimetype: file.mimetype,
  });

  return {
    profile_image_url: uploaded.secure_url,
    profile_image_public_id: uploaded.public_id,
  };
}

async function deleteProfileImage(publicId) {
  return deleteResource(publicId);
}

module.exports = {
  deleteProfileImage,
  uploadProfileImage,
};
