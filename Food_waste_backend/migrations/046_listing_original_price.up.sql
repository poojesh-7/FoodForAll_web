ALTER TABLE public.food_listings
  ADD COLUMN IF NOT EXISTS original_price NUMERIC(10,2) NULL;
