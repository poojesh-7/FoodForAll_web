const MINUTES_TO_MS = 60 * 1000;

const DEFAULT_OPERATIONAL_POLICY_MINUTES = Object.freeze({
  VOLUNTEER_PICKUP_TIMEOUT_MINUTES: 15,
  VOLUNTEER_DELIVERY_TIMEOUT_MINUTES: 30,
  FOOD_MIN_PICKUP_WINDOW_MINUTES: 30,
  FOOD_MIN_NGO_RESCUE_REMAINING_MINUTES: 30,
  FOOD_EXPIRY_ALERT_LEAD_MINUTES: 30,
  SELF_PICKUP_CANCELLATION_CUTOFF_MINUTES: 20,
  PAYMENT_HOLD_TIMEOUT_MINUTES: 10,
});

function parsePositiveIntegerMinutes(name, fallback, env = process.env) {
  const raw = String(env[name] ?? fallback).trim();
  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer minute value`);
  }

  return value;
}

function minutesToMs(minutes) {
  return minutes * MINUTES_TO_MS;
}

function buildOperationalPolicy(env = process.env) {
  const volunteerPickupTimeoutMinutes = parsePositiveIntegerMinutes(
    "VOLUNTEER_PICKUP_TIMEOUT_MINUTES",
    DEFAULT_OPERATIONAL_POLICY_MINUTES.VOLUNTEER_PICKUP_TIMEOUT_MINUTES,
    env
  );
  const volunteerDeliveryTimeoutMinutes = parsePositiveIntegerMinutes(
    "VOLUNTEER_DELIVERY_TIMEOUT_MINUTES",
    DEFAULT_OPERATIONAL_POLICY_MINUTES.VOLUNTEER_DELIVERY_TIMEOUT_MINUTES,
    env
  );
  const foodMinPickupWindowMinutes = parsePositiveIntegerMinutes(
    "FOOD_MIN_PICKUP_WINDOW_MINUTES",
    DEFAULT_OPERATIONAL_POLICY_MINUTES.FOOD_MIN_PICKUP_WINDOW_MINUTES,
    env
  );
  const foodMinNgoRescueRemainingMinutes = parsePositiveIntegerMinutes(
    "FOOD_MIN_NGO_RESCUE_REMAINING_MINUTES",
    DEFAULT_OPERATIONAL_POLICY_MINUTES.FOOD_MIN_NGO_RESCUE_REMAINING_MINUTES,
    env
  );
  const foodExpiryAlertLeadMinutes = parsePositiveIntegerMinutes(
    "FOOD_EXPIRY_ALERT_LEAD_MINUTES",
    DEFAULT_OPERATIONAL_POLICY_MINUTES.FOOD_EXPIRY_ALERT_LEAD_MINUTES,
    env
  );
  const selfPickupCancellationCutoffMinutes = parsePositiveIntegerMinutes(
    "SELF_PICKUP_CANCELLATION_CUTOFF_MINUTES",
    DEFAULT_OPERATIONAL_POLICY_MINUTES.SELF_PICKUP_CANCELLATION_CUTOFF_MINUTES,
    env
  );
  const paymentHoldTimeoutMinutes = parsePositiveIntegerMinutes(
    "PAYMENT_HOLD_TIMEOUT_MINUTES",
    DEFAULT_OPERATIONAL_POLICY_MINUTES.PAYMENT_HOLD_TIMEOUT_MINUTES,
    env
  );

  return Object.freeze({
    volunteer: Object.freeze({
      pickupTimeoutMinutes: volunteerPickupTimeoutMinutes,
      pickupTimeoutMs: minutesToMs(volunteerPickupTimeoutMinutes),
      deliveryTimeoutMinutes: volunteerDeliveryTimeoutMinutes,
      deliveryTimeoutMs: minutesToMs(volunteerDeliveryTimeoutMinutes),
    }),
    food: Object.freeze({
      minPickupWindowMinutes: foodMinPickupWindowMinutes,
      minPickupWindowMs: minutesToMs(foodMinPickupWindowMinutes),
      minNgoRescueRemainingMinutes: foodMinNgoRescueRemainingMinutes,
      minNgoRescueRemainingMs: minutesToMs(foodMinNgoRescueRemainingMinutes),
      expiryAlertLeadMinutes: foodExpiryAlertLeadMinutes,
      expiryAlertLeadMs: minutesToMs(foodExpiryAlertLeadMinutes),
    }),
    reservation: Object.freeze({
      selfPickupCancellationCutoffMinutes,
      selfPickupCancellationCutoffMs: minutesToMs(
        selfPickupCancellationCutoffMinutes
      ),
    }),
    payment: Object.freeze({
      holdTimeoutMinutes: paymentHoldTimeoutMinutes,
      holdTimeoutMs: minutesToMs(paymentHoldTimeoutMinutes),
    }),
  });
}

module.exports = {
  DEFAULT_OPERATIONAL_POLICY_MINUTES,
  buildOperationalPolicy,
  operationalPolicy: buildOperationalPolicy(),
};
