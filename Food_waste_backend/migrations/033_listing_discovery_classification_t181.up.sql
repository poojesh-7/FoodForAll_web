ALTER TABLE food_listings
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS dietary_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE food_listings
SET category = 'other'
WHERE category IS NULL OR TRIM(category) = '';

UPDATE food_listings
SET dietary_tags = ARRAY[]::TEXT[]
WHERE dietary_tags IS NULL;

ALTER TABLE food_listings
  DROP CONSTRAINT IF EXISTS food_listings_category_valid,
  ADD CONSTRAINT food_listings_category_valid
    CHECK (
      category IN (
        'meals',
        'bakery',
        'beverages',
        'fruits',
        'vegetables',
        'dairy',
        'snacks',
        'prepared_food',
        'grocery',
        'other'
      )
    );

ALTER TABLE food_listings
  DROP CONSTRAINT IF EXISTS food_listings_dietary_tags_valid,
  ADD CONSTRAINT food_listings_dietary_tags_valid
    CHECK (
      dietary_tags <@ ARRAY[
        'vegetarian',
        'vegan',
        'egg',
        'non_veg',
        'halal',
        'jain',
        'gluten_free'
      ]::TEXT[]
    );

CREATE INDEX IF NOT EXISTS idx_food_listings_category
  ON food_listings (category);

CREATE INDEX IF NOT EXISTS idx_food_listings_dietary_tags
  ON food_listings USING GIN (dietary_tags);
