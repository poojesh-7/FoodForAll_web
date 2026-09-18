const generatePickupCode = require("../../utils/codeGenerator");

function populateReservationPickupCodes(reservation = {}) {
  const nextReservation = { ...reservation };

  if (nextReservation.pickup_code === undefined || nextReservation.pickup_code === null || nextReservation.pickup_code === "") {
    nextReservation.pickup_code = generatePickupCode();
  }

  if (nextReservation.receive_code === undefined || nextReservation.receive_code === null || nextReservation.receive_code === "") {
    nextReservation.receive_code = generatePickupCode();
  }

  return nextReservation;
}

module.exports = {
  populateReservationPickupCodes,
};
