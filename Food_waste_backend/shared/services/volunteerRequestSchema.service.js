const pool = require("../config/db");

let schemaReady;

function ensureVolunteerRequestSchema(client = pool) {
  if (!schemaReady || client !== pool) {
    const run = async () => {
      await client.query(`
        ALTER TABLE volunteer_requests
        ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'ngo_invite'
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_volunteer_requests_lookup
        ON volunteer_requests (ngo_id, volunteer_id, request_type, status)
      `);
    };

    if (client === pool) {
      schemaReady = run();
      return schemaReady;
    }

    return run();
  }

  return schemaReady;
}

module.exports = {
  ensureVolunteerRequestSchema,
};
