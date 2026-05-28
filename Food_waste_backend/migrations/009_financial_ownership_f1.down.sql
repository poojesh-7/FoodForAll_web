DROP TRIGGER IF EXISTS trg_payment_ownership_immutable ON payment_ownership;

DROP INDEX IF EXISTS idx_payment_ownership_refund_target;
DROP INDEX IF EXISTS idx_payment_ownership_provider;
DROP INDEX IF EXISTS idx_payment_ownership_payer;
DROP INDEX IF EXISTS idx_payment_ownership_payment_session;
DROP INDEX IF EXISTS idx_payment_ownership_reservation;
DROP INDEX IF EXISTS idx_payment_ownership_reservation_session_version;

DROP TABLE IF EXISTS payment_ownership;

DROP FUNCTION IF EXISTS prevent_payment_ownership_mutation();
