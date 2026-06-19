const crypto = require("crypto");
const logger = require("../utils/logger");
const { deleteResource, uploadBuffer } = require("./cloudinary.service");

const MAX_LISTING_IMAGES = 5;

function listingImagesSelect(listingAlias = "f") {
  return `
    (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'listing_id', li.listing_id,
            'image_url', li.image_url,
            'public_id', li.public_id,
            'display_order', li.display_order
          )
          ORDER BY li.display_order ASC
        ),
        '[]'::jsonb
      )
      FROM listing_images li
      WHERE li.listing_id=${listingAlias}.id
    ) AS images,
    (
      SELECT li.image_url
      FROM listing_images li
      WHERE li.listing_id=${listingAlias}.id
      ORDER BY li.display_order ASC
      LIMIT 1
    ) AS primary_image_url
  `;
}

function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return fallback;

  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function normalizeListingImages(row) {
  if (!row) return row;

  const images = Array.isArray(row.images) ? row.images : [];
  return {
    ...row,
    images,
    primary_image_url:
      row.primary_image_url || images.find((image) => image?.image_url)?.image_url || null,
  };
}

async function loadListingImages(client, listingId, { lock = false } = {}) {
  const result = await client.query(
    `
    SELECT listing_id, image_url, public_id, display_order
    FROM listing_images
    WHERE listing_id=$1
    ORDER BY display_order ASC
    ${lock ? "FOR UPDATE" : ""}
    `,
    [listingId]
  );

  return result.rows;
}

async function uploadListingImage(listingId, file, index) {
  const storagePrefix = process.env.ENV_RESOURCE_PREFIX || process.env.APP_ENV || "local";
  const nonce =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString("hex");

  const uploaded = await uploadBuffer(file.buffer, {
    folder: `food-rescue/${storagePrefix}/listings/${listingId}`,
    public_id: `listing_${listingId}_${index}_${nonce}`,
    overwrite: false,
    invalidate: true,
    mimetype: file.mimetype,
  });

  return {
    listing_id: listingId,
    image_url: uploaded.secure_url,
    public_id: uploaded.public_id,
  };
}

async function insertImageRows(client, listingId, images, offset = 1000) {
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    await client.query(
      `
      INSERT INTO listing_images (listing_id, image_url, public_id, display_order)
      VALUES ($1, $2, $3, $4)
      `,
      [listingId, image.image_url, image.public_id, offset + index]
    );
  }
}

async function applyDisplayOrder(client, listingId, images) {
  if (!images.length) return;

  const maxOrderResult = await client.query(
    `
    SELECT COALESCE(MAX(display_order), 0)::int AS max_display_order
    FROM listing_images
    WHERE listing_id=$1
    `,
    [listingId]
  );
  const tempBase =
    Number(maxOrderResult.rows[0]?.max_display_order || 0) +
    images.length +
    MAX_LISTING_IMAGES +
    1;

  for (let index = 0; index < images.length; index += 1) {
    await client.query(
      `
      UPDATE listing_images
      SET display_order=$1
      WHERE listing_id=$2
      AND public_id=$3
      `,
      [tempBase + index, listingId, images[index].public_id]
    );
  }

  for (let index = 0; index < images.length; index += 1) {
    await client.query(
      `
      UPDATE listing_images
      SET display_order=$1
      WHERE listing_id=$2
      AND public_id=$3
      `,
      [index, listingId, images[index].public_id]
    );
  }
}

function orderedImages(images, orderTokens) {
  const byToken = new Map();
  images.forEach((image) => {
    byToken.set(image.public_id, image);
    if (image.clientToken) byToken.set(`new:${image.clientToken}`, image);
  });

  const ordered = [];
  const used = new Set();

  orderTokens.forEach((token) => {
    const image = byToken.get(String(token));
    if (!image || used.has(image.public_id)) return;
    ordered.push(image);
    used.add(image.public_id);
  });

  images.forEach((image) => {
    if (!used.has(image.public_id)) ordered.push(image);
  });

  return ordered.map(({ clientToken, ...image }) => image);
}

async function addListingImages(client, listingId, files = []) {
  if (!files.length) return [];
  if (files.length > MAX_LISTING_IMAGES) {
    const error = new Error(`Listings can include up to ${MAX_LISTING_IMAGES} images`);
    error.statusCode = 400;
    throw error;
  }

  const uploaded = [];

  try {
    for (let index = 0; index < files.length; index += 1) {
      uploaded.push(await uploadListingImage(listingId, files[index], index));
    }

    await insertImageRows(client, listingId, uploaded, 0);
    return uploaded.map((image, index) => ({ ...image, display_order: index }));
  } catch (err) {
    await Promise.all(
      uploaded.map((image) =>
        deleteResource(image.public_id).catch((deleteErr) => {
          logger.warn("Listing image cleanup failed", {
            err: deleteErr,
            listingId,
            publicId: image.public_id,
          });
        })
      )
    );
    throw err;
  }
}

async function updateListingImages(client, listingId, body = {}, files = []) {
  const existing = await loadListingImages(client, listingId, { lock: true });
  const removedPublicIds = new Set(
    parseJsonArray(body.removed_image_public_ids).map((item) => String(item))
  );
  const remaining = existing.filter((image) => !removedPublicIds.has(image.public_id));
  const uploadOffset =
    Math.max(
      0,
      ...existing.map((image) => Number(image.display_order)).filter(Number.isFinite)
    ) +
    MAX_LISTING_IMAGES +
    1;

  if (remaining.length + files.length > MAX_LISTING_IMAGES) {
    const error = new Error(`Listings can include up to ${MAX_LISTING_IMAGES} images`);
    error.statusCode = 400;
    throw error;
  }

  const newClientIds = parseJsonArray(body.new_image_client_ids);
  const uploaded = [];

  try {
    if (removedPublicIds.size > 0) {
      await client.query(
        `
        DELETE FROM listing_images
        WHERE listing_id=$1
        AND public_id = ANY($2::text[])
        `,
        [listingId, [...removedPublicIds]]
      );
    }

    for (let index = 0; index < files.length; index += 1) {
      uploaded.push({
        ...(await uploadListingImage(listingId, files[index], index)),
        clientToken: String(newClientIds[index] || index),
      });
    }

    await insertImageRows(client, listingId, uploaded, uploadOffset);

    const imageOrder = parseJsonArray(body.image_order);
    const ordered = orderedImages([...remaining, ...uploaded], imageOrder);
    await applyDisplayOrder(client, listingId, ordered);

    return ordered.map((image, index) => ({ ...image, display_order: index }));
  } catch (err) {
    await Promise.all(
      uploaded.map((image) =>
        deleteResource(image.public_id).catch((deleteErr) => {
          logger.warn("Listing image cleanup failed", {
            err: deleteErr,
            listingId,
            publicId: image.public_id,
          });
        })
      )
    );
    throw err;
  }
}

async function deleteRemovedImages(publicIds) {
  await Promise.all(
    publicIds.map((publicId) =>
      deleteResource(publicId).catch((err) => {
        logger.warn("Listing image delete failed", { err, publicId });
      })
    )
  );
}

module.exports = {
  MAX_LISTING_IMAGES,
  addListingImages,
  deleteRemovedImages,
  listingImagesSelect,
  loadListingImages,
  normalizeListingImages,
  parseJsonArray,
  updateListingImages,
};
