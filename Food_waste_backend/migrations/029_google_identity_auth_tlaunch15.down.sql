DROP INDEX IF EXISTS users_google_id_unique_idx;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_auth_provider_check,
  DROP COLUMN IF EXISTS phone_verified_at,
  DROP COLUMN IF EXISTS auth_provider,
  DROP COLUMN IF EXISTS email_verified,
  DROP COLUMN IF EXISTS google_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    WHERE phone IS NULL
  ) THEN
    RAISE NOTICE 'Skipping users.phone NOT NULL restoration because null phone contacts exist';
  ELSE
    ALTER TABLE users
      ALTER COLUMN phone SET NOT NULL;
  END IF;
END
$$;
