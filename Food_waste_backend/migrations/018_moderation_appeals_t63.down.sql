DROP INDEX IF EXISTS idx_moderation_appeal_events_actor_created;
DROP INDEX IF EXISTS idx_moderation_appeal_events_case_created;
DROP INDEX IF EXISTS idx_moderation_appeal_events_appeal_created;
DROP TABLE IF EXISTS moderation_appeal_events;

DROP INDEX IF EXISTS idx_moderation_appeal_attachments_uploader_created;
DROP INDEX IF EXISTS idx_moderation_appeal_attachments_appeal;
DROP TABLE IF EXISTS moderation_appeal_attachments;

DROP INDEX IF EXISTS idx_moderation_appeals_provider_updated;
DROP INDEX IF EXISTS idx_moderation_appeals_status_updated;
DROP INDEX IF EXISTS idx_moderation_appeals_case_provider;
DROP TABLE IF EXISTS moderation_appeals;
