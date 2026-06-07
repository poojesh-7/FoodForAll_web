DROP TRIGGER IF EXISTS trg_admin_trust_actions_immutable ON admin_trust_actions;
DROP FUNCTION IF EXISTS prevent_admin_trust_action_mutation();

DROP INDEX IF EXISTS idx_admin_trust_actions_idempotency;
DROP INDEX IF EXISTS idx_admin_trust_actions_type_created;
DROP INDEX IF EXISTS idx_admin_trust_actions_admin_created;
DROP INDEX IF EXISTS idx_admin_trust_actions_subject_created;

DROP TABLE IF EXISTS admin_trust_actions;
