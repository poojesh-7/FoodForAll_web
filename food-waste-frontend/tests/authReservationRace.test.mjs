import assert from "node:assert/strict";
import test from "node:test";
import { canResumeReservationFetch } from "../lib/authReady.ts";

test("reservation fetch waits for auth bootstrap to finish", () => {
  assert.equal(
    canResumeReservationFetch({ initialized: false, isInitializing: false, user: null }),
    false
  );

  assert.equal(
    canResumeReservationFetch({
      initialized: true,
      isInitializing: false,
      isAuthenticated: true,
      user: { id: "user-1" },
    }),
    true
  );

  assert.equal(
    canResumeReservationFetch({
      initialized: true,
      isInitializing: true,
      isAuthenticated: true,
      user: { id: "user-1" },
    }),
    false
  );
});
