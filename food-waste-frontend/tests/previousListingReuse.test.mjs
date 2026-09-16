import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../app/provider/listings/create/page.tsx", import.meta.url),
  "utf8"
);
const food = readFileSync(new URL("../lib/food.ts", import.meta.url), "utf8");

test("previous listing selector uses the existing listings flow and owns its results", () => {
  assert.match(page, /foodService\s*\.\s*getAllFood\s*\(\s*\)/);
  assert.match(page, /provider_id\) === String\(user\?\.id\)/);
  assert.match(page, /Previous listings/);
  assert.match(page, /Loading previous listings/);
  assert.match(page, /No previous listings found/);
  assert.match(page, /previousListingsError/);
  assert.match(page, /aria-label="Close previous listings"/);
  assert.match(page, /onMouseDown=\{onClose\}/);
  assert.match(page, /onUse\(listing\)/);
});

test("reuse maps allowed fields and resets listing-specific values", () => {
  assert.match(food, /getReusableFoodFormValues/);
  assert.match(food, /title: String\(listing\.title/);
  assert.match(food, /description: String\(listing\.description/);
  assert.match(food, /quantity_unit: String\(listing\.quantity_unit/);
  assert.match(food, /custom_quantity_unit: String\(listing\.custom_quantity_unit/);
  assert.match(food, /category: String\(listing\.category/);
  assert.match(food, /dietary_tags: Array\.isArray\(listing\.dietary_tags\)/);
  assert.match(food, /price: String\(listing\.price/);
  assert.match(food, /original_price: listing\.original_price == null \? ""/);
  assert.match(food, /is_free: Boolean\(listing\.is_free\)/);
  assert.match(food, /quantity: ""/);
  assert.match(food, /pickup_start_time: ""/);
  assert.match(food, /pickup_end_time: ""/);
  assert.match(food, /images: \[\]/);
  assert.doesNotMatch(food, /id: listing\.id/);
  assert.doesNotMatch(food, /provider_id: listing\.provider_id/);
  assert.doesNotMatch(food, /remaining_quantity: listing\.remaining_quantity/);
});

test("reuse closes with confirmation and create still uses the create API", () => {
  assert.match(page, /setPreviousListingsOpen\(false\)/);
  assert.match(page, /Previous listing loaded\. You can edit the details/);
  assert.match(page, /foodService\.createFood\(/);
  assert.doesNotMatch(page, /foodService\.updateFood\(/);
  assert.doesNotMatch(page, /previousListingId/);
});
