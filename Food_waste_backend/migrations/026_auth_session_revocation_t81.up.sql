ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_session_version INTEGER NOT NULL DEFAULT 0;

UPDATE users
SET auth_session_version = 0
WHERE auth_session_version IS NULL;

ALTER TABLE users
  ALTER COLUMN auth_session_version SET DEFAULT 0,
  ALTER COLUMN auth_session_version SET NOT NULL;
