ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_image_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_image_public_id TEXT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_profile_image_url_nonempty
    CHECK (profile_image_url IS NULL OR LENGTH(TRIM(profile_image_url)) > 0),
  ADD CONSTRAINT users_profile_image_public_id_nonempty
    CHECK (profile_image_public_id IS NULL OR LENGTH(TRIM(profile_image_public_id)) > 0);

CREATE UNIQUE INDEX IF NOT EXISTS users_profile_image_public_id_unique
  ON users (profile_image_public_id)
  WHERE profile_image_public_id IS NOT NULL;
