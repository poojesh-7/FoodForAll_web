const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SessionSecurityError,
  assertAccessTokenSession,
  getTokenSessionVersion,
  toSessionVersion,
} = require("../shared/services/sessionSecurity.service");

function clientWithRows(rows) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql: String(sql), params });
      return { rows, rowCount: rows.length };
    },
  };
}

test("session version defaults are backwards-compatible with existing tokens", () => {
  assert.equal(toSessionVersion(undefined), 0);
  assert.equal(getTokenSessionVersion({}), 0);
  assert.equal(getTokenSessionVersion({ sv: 2 }), 2);
});

test("access token session accepts matching current user version", async () => {
  const client = clientWithRows([
    { id: "user-1", role: "user", auth_session_version: 3 },
  ]);

  const session = await assertAccessTokenSession({
    client,
    decoded: { id: "user-1", role: "provider", sv: 3 },
  });

  assert.equal(session.id, "user-1");
  assert.equal(session.role, "user");
  assert.equal(session.auth_session_version, 3);
  assert.equal(client.calls[0].params[0], "user-1");
});

test("access token session rejects revoked token versions", async () => {
  const client = clientWithRows([
    { id: "user-1", role: "user", auth_session_version: 4 },
  ]);

  await assert.rejects(
    () =>
      assertAccessTokenSession({
        client,
        decoded: { id: "user-1", role: "user", sv: 3 },
      }),
    (err) => {
      assert.ok(err instanceof SessionSecurityError);
      assert.equal(err.reason, "access_token_revoked");
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});

test("access token session rejects tokens for missing users", async () => {
  const client = clientWithRows([]);

  await assert.rejects(
    () =>
      assertAccessTokenSession({
        client,
        decoded: { id: "missing-user", role: "user", sv: 0 },
      }),
    (err) => {
      assert.ok(err instanceof SessionSecurityError);
      assert.equal(err.reason, "user_not_found");
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});
