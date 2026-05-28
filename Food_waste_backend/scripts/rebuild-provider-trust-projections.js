const { loadEnv } = require("./load-env");

loadEnv();

const pool = require("../shared/config/db");
const {
  rebuildTrustProjectionForSubject,
} = require("../shared/services/trustProjection.service");

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

async function listProviderSubjectIds(afterSubjectId, limit) {
  const result = await pool.query(
    `
    SELECT subject_id
    FROM trust_events
    WHERE subject_type='provider'
    AND processing_status='processed'
    AND ($1::uuid IS NULL OR subject_id > $1::uuid)
    GROUP BY subject_id
    ORDER BY subject_id ASC
    LIMIT $2
    `,
    [afterSubjectId, limit]
  );

  return result.rows.map((row) => row.subject_id);
}

async function rebuildOneProvider(subjectId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await rebuildTrustProjectionForSubject(client, {
      subjectType: "provider",
      subjectId,
    });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const batchSize = Math.max(
    1,
    Math.min(Number(argValue("batch-size", process.env.TRUST_REBUILD_BATCH_SIZE || 50)), 250)
  );
  let afterSubjectId = argValue("after-subject-id", null);
  let rebuilt = 0;

  while (true) {
    const subjectIds = await listProviderSubjectIds(afterSubjectId, batchSize);
    if (!subjectIds.length) break;

    for (const subjectId of subjectIds) {
      const result = await rebuildOneProvider(subjectId);
      rebuilt += 1;
      process.stdout.write(
        `rebuilt provider ${subjectId} from ${result.eventCount} trust event(s)\n`
      );
      afterSubjectId = subjectId;
    }

    if (subjectIds.length < batchSize) break;
  }

  process.stdout.write(`rebuilt ${rebuilt} provider trust projection(s)\n`);
}

main()
  .catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
