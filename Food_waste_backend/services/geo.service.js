const redis = require("../shared/config/redis");

async function addNGOLocation(ngoId, longitude, latitude) {
  await redis.geoAdd("ngo_locations", {
    longitude,
    latitude,
    member: ngoId,
  });
}

async function findNearbyNGOs(longitude, latitude, radiusKm = 5) {
  const results = await redis.geoSearch(
    "ngo_locations",
    {
      longitude,
      latitude,
    },
    {
      radius: radiusKm,
      unit: "km",
    },
  );

  return results; // returns NGO IDs
}

module.exports = {
  addNGOLocation,
  findNearbyNGOs,
};
