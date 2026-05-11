const pool = require("../shared/config/db");
const redis = require("../shared/config/redis");
const logger = require("../shared/utils/logger");

async function syncNGOLocations() {
  try {
    const ngos = await pool.query(`
      SELECT id, latitude, longitude
      FROM ngos
      WHERE latitude IS NOT NULL
      AND longitude IS NOT NULL
    `);

    if (!ngos.rows.length) return;

    const geoData = ngos.rows.map((ngo) => ({
      longitude: ngo.longitude,
      latitude: ngo.latitude,
      member: ngo.id,
    }));

    await redis.geoAdd("ngo_locations", geoData);

    logger.info("NGO locations synced");
  } catch (err) {
    logger.error("NGO location sync failed", { err });
  }
}

function startNGOLocationSyncWorker() {
  syncNGOLocations();

  // repeat every 10 minutes
  setInterval(syncNGOLocations, 600000);
}

module.exports = startNGOLocationSyncWorker;
