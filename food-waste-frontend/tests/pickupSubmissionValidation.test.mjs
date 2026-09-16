import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../app/provider/listings/create/page.tsx", import.meta.url),
  "utf8"
);
const food = readFileSync(new URL("../lib/food.ts", import.meta.url), "utf8");

test("submission calculates the final pickup start before end-window validation", () => {
  assert.match(page, /getFinalPickupStartTime\(\s*sanitizedValues\.pickup_start_time/);
  assert.match(page, /pickup_start_time: finalPickupStartTime/);
  assert.match(page, /endTime - finalStartTime < 30 \* 60 \* 1000/);
  assert.match(page, /Pickup end time must be at least 30 minutes after the pickup start time\./);
});

test("stale pickup starts round forward without modifying pickup end", () => {
  assert.match(food, /startTime > now\.getTime\(\)/);
  assert.match(food, /remainder === 0 \? 0 : 5 - remainder/);
  assert.match(food, /nextStart\.getTime\(\) <= now\.getTime\(\)/);
  assert.doesNotMatch(page, /setValues\([^)]*pickup_end_time/);
});

test("create submission still uses the create API and existing validation", () => {
  assert.match(page, /getFoodValidationError\(finalValues\)/);
  assert.match(page, /foodService\.createFood\(/);
  assert.doesNotMatch(page, /foodService\.updateFood\(/);
  assert.doesNotMatch(page, /grace|allowPast/);
});