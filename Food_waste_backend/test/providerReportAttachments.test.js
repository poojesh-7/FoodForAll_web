const assert = require("node:assert/strict");
const test = require("node:test");

process.env.CLOUDINARY_CLOUD_NAME ||= "cloud";
process.env.CLOUDINARY_API_KEY ||= "cloudinary-key";
process.env.CLOUDINARY_API_SECRET ||= "cloudinary-secret";

const {
  assertSafeImageBuffer,
} = require("../shared/services/cloudinary.service");
const {
  addProviderReportAttachments,
  listProviderReports,
} = require("../shared/services/moderation.service");

const originalFetch = global.fetch;

function imageFile({ mimetype, buffer, size = buffer.length, name = "image" }) {
  return {
    buffer,
    mimetype,
    originalname: name,
    size,
  };
}

function jpegBuffer() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
}

function pngBuffer() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
  ]);
}

function webpBuffer() {
  return Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
}

function createClient() {
  const calls = [];
  let attachmentId = 0;

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("INSERT INTO provider_report_attachments")) {
        attachmentId += 1;
        return {
          rows: [
            {
              id: `attachment-${attachmentId}`,
              report_id: params[0],
              uploader_user_id: params[1],
              file_url: params[2],
              mime_type: params[3],
              file_size_bytes: params[4],
              created_at: "2026-06-05T00:00:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("FROM provider_reports pr")) {
        return {
          rows: [
            {
              id: "report-1",
              attachments: [
                {
                  id: "attachment-1",
                  file_url: "https://res.cloudinary.com/demo/image/upload/evidence.webp",
                },
              ],
            },
          ],
        };
      }

      return { rows: [] };
    },
  };
}

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("Cloudinary image validation accepts WebP magic bytes", () => {
  assert.doesNotThrow(() => {
    assertSafeImageBuffer(webpBuffer(), "image/webp");
  });
});

test("Cloudinary image validation rejects MIME and content mismatch", () => {
  assert.throws(
    () => assertSafeImageBuffer(webpBuffer(), "image/png"),
    /Uploaded file content does not match its image type/
  );
});

test("provider report attachment upload stores metadata rows", async () => {
  const client = createClient();
  const fetchCalls = [];
  global.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          secure_url: `https://res.cloudinary.com/demo/image/upload/report-${fetchCalls.length}.webp`,
        };
      },
    };
  };

  const attachments = await addProviderReportAttachments({
    client,
    reportId: "report-1",
    uploaderUserId: "user-1",
    files: [
      imageFile({ mimetype: "image/jpeg", buffer: jpegBuffer(), name: "one.jpg" }),
      imageFile({ mimetype: "image/png", buffer: pngBuffer(), name: "two.png" }),
      imageFile({ mimetype: "image/webp", buffer: webpBuffer(), name: "three.webp" }),
    ],
  });

  assert.equal(fetchCalls.length, 3);
  assert.equal(attachments.length, 3);
  assert.deepEqual(
    attachments.map((attachment) => attachment.mime_type),
    ["image/jpeg", "image/png", "image/webp"]
  );
  assert.equal(
    client.calls.filter((call) => call.sql.includes("INSERT INTO provider_report_attachments")).length,
    3
  );
});

test("provider report attachment upload allows reports without images", async () => {
  const client = createClient();

  const attachments = await addProviderReportAttachments({
    client,
    reportId: "report-1",
    uploaderUserId: "user-1",
    files: [],
  });

  assert.deepEqual(attachments, []);
  assert.equal(
    client.calls.some((call) => call.sql.includes("INSERT INTO provider_report_attachments")),
    false
  );
});

test("provider report attachment upload rejects more than three images", async () => {
  const client = createClient();
  global.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  await assert.rejects(
    () =>
      addProviderReportAttachments({
        client,
        reportId: "report-1",
        uploaderUserId: "user-1",
        files: [jpegBuffer(), jpegBuffer(), jpegBuffer(), jpegBuffer()].map((buffer) =>
          imageFile({ mimetype: "image/jpeg", buffer })
        ),
      }),
    /up to 3 images/
  );
});

test("provider report attachment upload rejects invalid MIME types", async () => {
  const client = createClient();

  await assert.rejects(
    () =>
      addProviderReportAttachments({
        client,
        reportId: "report-1",
        uploaderUserId: "user-1",
        files: [
          imageFile({
            mimetype: "application/pdf",
            buffer: Buffer.from("%PDF-1.7"),
            name: "evidence.pdf",
          }),
        ],
      }),
    /Only JPG, JPEG, PNG, or WEBP images allowed/
  );
});

test("provider report attachment upload rejects oversized images", async () => {
  const client = createClient();

  await assert.rejects(
    () =>
      addProviderReportAttachments({
        client,
        reportId: "report-1",
        uploaderUserId: "user-1",
        files: [
          imageFile({
            mimetype: "image/jpeg",
            buffer: jpegBuffer(),
            size: 5 * 1024 * 1024 + 1,
            name: "large.jpg",
          }),
        ],
      }),
    /too large/
  );
});

test("admin provider report list includes attachment aggregation", async () => {
  const client = createClient();

  const reports = await listProviderReports({ client, status: "pending" });

  const listQuery = client.calls.find((call) => call.sql.includes("FROM provider_reports pr"));
  assert.match(listQuery.sql, /provider_report_attachments/);
  assert.match(listQuery.sql, /json_agg/);
  assert.equal(reports[0].attachments.length, 1);
});
