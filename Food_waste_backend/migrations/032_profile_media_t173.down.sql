DROP INDEX IF EXISTS users_profile_image_public_id_unique;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_profile_image_url_nonempty,
  DROP CONSTRAINT IF EXISTS users_profile_image_public_id_nonempty;

ALTER TABLE users
  DROP COLUMN IF EXISTS profile_image_public_id,
  DROP COLUMN IF EXISTS profile_image_url;
