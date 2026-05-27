DROP INDEX IF EXISTS idx_trust_event_effects_subject;
DROP INDEX IF EXISTS idx_trust_restrictions_subject;
DROP INDEX IF EXISTS idx_trust_restrictions_subject_type;
DROP INDEX IF EXISTS idx_trust_events_payment;
DROP INDEX IF EXISTS idx_trust_events_reservation;
DROP INDEX IF EXISTS idx_trust_events_source;
DROP INDEX IF EXISTS idx_trust_events_subject_history;
DROP INDEX IF EXISTS idx_trust_events_processing;

DROP TABLE IF EXISTS trust_event_effects;
DROP TABLE IF EXISTS trust_restrictions;
DROP TABLE IF EXISTS trust_scores;
DROP TABLE IF EXISTS trust_events;
