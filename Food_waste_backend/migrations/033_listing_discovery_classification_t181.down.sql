DROP INDEX IF EXISTS idx_food_listings_dietary_tags;
DROP INDEX IF EXISTS idx_food_listings_category;

ALTER TABLE food_listings
  DROP CONSTRAINT IF EXISTS food_listings_dietary_tags_valid,
  DROP CONSTRAINT IF EXISTS food_listings_category_valid,
  DROP COLUMN IF EXISTS dietary_tags,
  DROP COLUMN IF EXISTS category;
