CREATE TABLE IF NOT EXISTS listing_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES food_listings(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  public_id TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT listing_images_display_order_nonnegative CHECK (display_order >= 0),
  CONSTRAINT listing_images_url_nonempty CHECK (LENGTH(TRIM(image_url)) > 0),
  CONSTRAINT listing_images_public_id_nonempty CHECK (LENGTH(TRIM(public_id)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS listing_images_public_id_unique
  ON listing_images (public_id);

CREATE UNIQUE INDEX IF NOT EXISTS listing_images_listing_order_unique
  ON listing_images (listing_id, display_order);

CREATE INDEX IF NOT EXISTS listing_images_listing_id_order_idx
  ON listing_images (listing_id, display_order);
