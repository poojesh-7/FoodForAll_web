ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'otp',
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP NULL;

UPDATE users
SET email_verified = false
WHERE email_verified IS NULL;

UPDATE users
SET auth_provider = 'otp'
WHERE auth_provider IS NULL OR trim(auth_provider) = '';

ALTER TABLE users
  ALTER COLUMN phone DROP NOT NULL,
  ALTER COLUMN email_verified SET DEFAULT false,
  ALTER COLUMN email_verified SET NOT NULL,
  ALTER COLUMN auth_provider SET DEFAULT 'otp',
  ALTER COLUMN auth_provider SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_auth_provider_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_auth_provider_check
      CHECK (auth_provider IN ('otp', 'google'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique_idx
  ON users (google_id)
  WHERE google_id IS NOT NULL AND trim(google_id) <> '';
