const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createProviderReport,
  dismissProviderReport,
  getModerationCaseDetail,
  listModerationAppeals,
  submitProviderModerationAppeal,
  submitProviderCaseResponse,
  transitionModerationAppealStatus,
  transitionModerationCaseStatus,
  validateProviderReport,
  withdrawProviderModerationAppeal,
} = require("../shared/services/moderation.service");

const PROVIDER_ID = "11111111-1111-4111-8111-111111111111";
const REPORTER_ID = "22222222-2222-4222-8222-222222222222";
const RESERVATION_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const REPORT_ID = "55555555-5555-4555-8555-555555555555";
const CASE_ID = "66666666-6666-4666-8666-666666666666";
const RESPONSE_ID = "77777777-7777-4777-8777-777777777777";
const APPEAL_ID = "88888888-8888-4888-8888-888888888888";

function providerReport(status = "pending", moderationCaseId = CASE_ID) {
  return {
    id: REPORT_ID,
    provider_id: PROVIDER_ID,
    reported_by: REPORTER_ID,
    reservation_id: RESERVATION_ID,
    moderation_case_id: moderationCaseId,
    reason: "unsafe_food",
    description: "Food smelled unsafe.",
    status,
    created_at: "2026-06-05T00:00:00.000Z",
    resolved_at: status === "pending" ? null : "2026-06-05T01:00:00.000Z",
    reviewed_by_admin: status === "pending" ? null : ADMIN_ID,
  };
}

function moderationCase(status = "OPEN") {
  return {
    id: CASE_ID,
    case_type: "provider_report",
    subject_type: "provider",
    subject_id: PROVIDER_ID,
    status,
    opened_by_user_id: REPORTER_ID,
    assigned_admin_id: status === "OPEN" ? null : ADMIN_ID,
    source_report_id: REPORT_ID,
    reason: "unsafe_food",
    summary: "Food smelled unsafe.",
    created_at: "2026-06-05T00:00:00.000Z",
    updated_at: "2026-06-05T00:00:00.000Z",
    closed_at: null,
  };
}

function providerResponse({
  responseText = "We checked the batch and can share pickup notes.",
  attachmentCount = 0,
} = {}) {
  return {
    id: RESPONSE_ID,
    case_id: CASE_ID,
    provider_id: PROVIDER_ID,
    provider_name: "Green Kitchen",
    response_text: responseText,
    created_at: "2026-06-05T00:30:00.000Z",
    updated_at: "2026-06-05T00:30:00.000Z",
    attachments: Array.from({ length: attachmentCount }, (_, index) => ({
      id: `response-attachment-${index + 1}`,
      response_id: RESPONSE_ID,
      file_url: `https://res.cloudinary.com/demo/image/upload/provider-response-${index + 1}.webp`,
      mime_type: "image/webp",
      file_size_bytes: 1024,
      created_at: "2026-06-05T00:31:00.000Z",
    })),
  };
}

function moderationAppeal({
  status = "SUBMITTED",
  appealText = "The report outcome missed our sealed handoff evidence.",
  attachmentCount = 0,
} = {}) {
  return {
    id: APPEAL_ID,
    case_id: CASE_ID,
    provider_id: PROVIDER_ID,
    provider_name: "Green Kitchen",
    reviewed_by_admin_name: status === "SUBMITTED" ? null : "Admin User",
    status,
    appeal_text: appealText,
    decision_note: ["ACCEPTED", "REJECTED"].includes(status)
      ? "Decision note"
      : null,
    reviewed_by_admin: ["ACCEPTED", "REJECTED"].includes(status)
      ? ADMIN_ID
      : null,
    submitted_at: "2026-06-05T02:00:00.000Z",
    reviewed_at: ["ACCEPTED", "REJECTED"].includes(status)
      ? "2026-06-05T03:00:00.000Z"
      : null,
    withdrawn_at: status === "WITHDRAWN" ? "2026-06-05T03:00:00.000Z" : null,
    withdrawn_by_user_id: status === "WITHDRAWN" ? PROVIDER_ID : null,
    created_at: "2026-06-05T02:00:00.000Z",
    updated_at: "2026-06-05T02:00:00.000Z",
    attachments: Array.from({ length: attachmentCount }, (_, index) => ({
      id: `appeal-attachment-${index + 1}`,
      appeal_id: APPEAL_ID,
      uploader_user_id: PROVIDER_ID,
      file_url: `https://res.cloudinary.com/demo/image/upload/appeal-${index + 1}.webp`,
      mime_type: "image/webp",
      file_size_bytes: 1024,
      created_at: "2026-06-05T02:01:00.000Z",
    })),
  };
}

function createClient(options = {}) {
  const calls = [];
  let currentCase = moderationCase(options.caseStatus || "OPEN");
  let currentResponse = options.existingResponse
    ? providerResponse({
        responseText: options.responseText,
        attachmentCount: options.responseAttachmentCount || 0,
      })
    : null;
  let currentAppeal = options.existingAppeal
    ? moderationAppeal({
        status: options.appealStatus || "SUBMITTED",
        appealText: options.appealText,
        attachmentCount: options.appealAttachmentCount || 0,
      })
    : null;
  let createdCaseCount = 0;
  let eventCount = 0;

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("FROM users") && sql.includes("WHERE id=$1")) {
        return {
          rows: [
            {
              id: params[0],
              role: "admin",
              is_verified: true,
              banned_until: null,
              cooldown_until: null,
              requires_reliability_deposit: false,
              restriction_level: 0,
              restriction_reason: null,
            },
          ],
        };
      }

      if (sql.includes("SELECT id") && sql.includes("FROM provider_reports")) {
        return { rows: [] };
      }

      if (
        sql.includes("SELECT *") &&
        sql.includes("FROM provider_case_responses")
      ) {
        return { rows: currentResponse ? [currentResponse] : [] };
      }

      if (
        sql.includes("UPDATE provider_case_responses") &&
        sql.includes("RETURNING *")
      ) {
        currentResponse = {
          ...(currentResponse || providerResponse()),
          response_text: params[2],
          updated_at: "2026-06-05T00:40:00.000Z",
        };
        return { rows: [currentResponse] };
      }

      if (
        sql.includes("INSERT INTO provider_case_responses") &&
        sql.includes("RETURNING *")
      ) {
        currentResponse = providerResponse({
          responseText: params[2],
          attachmentCount: 0,
        });
        return { rows: [currentResponse] };
      }

      if (
        sql.includes("COUNT(*)::int AS attachment_count") &&
        sql.includes("FROM provider_case_response_attachments")
      ) {
        return {
          rows: [
            {
              attachment_count: currentResponse?.attachments?.length || 0,
            },
          ],
        };
      }

      if (
        sql.includes("SELECT *") &&
        sql.includes("FROM moderation_appeals")
      ) {
        return { rows: currentAppeal ? [currentAppeal] : [] };
      }

      if (
        sql.includes("INSERT INTO moderation_appeals") &&
        sql.includes("RETURNING *")
      ) {
        currentAppeal = moderationAppeal({
          status: "SUBMITTED",
          appealText: params[2],
        });
        return { rows: [currentAppeal] };
      }

      if (sql.includes("INSERT INTO moderation_appeal_attachments")) {
        const attachment = {
          id: `appeal-attachment-${(currentAppeal?.attachments?.length || 0) + 1}`,
          appeal_id: params[0],
          uploader_user_id: params[1],
          file_url: params[2],
          mime_type: params[3],
          file_size_bytes: params[4],
          created_at: "2026-06-05T02:01:00.000Z",
        };
        currentAppeal = {
          ...(currentAppeal || moderationAppeal()),
          attachments: [...(currentAppeal?.attachments || []), attachment],
        };
        return { rows: [attachment] };
      }

      if (
        sql.includes("SELECT ma.*, mc.status AS case_status") &&
        sql.includes("FROM moderation_appeals ma")
      ) {
        return {
          rows: currentAppeal
            ? [{ ...currentAppeal, case_status: currentCase.status }]
            : [],
        };
      }

      if (
        sql.includes("UPDATE moderation_appeals") &&
        sql.includes("status='WITHDRAWN'")
      ) {
        currentAppeal = {
          ...(currentAppeal || moderationAppeal()),
          status: "WITHDRAWN",
          withdrawn_at: "2026-06-05T03:00:00.000Z",
          withdrawn_by_user_id: params[2],
          updated_at: "2026-06-05T03:00:00.000Z",
        };
        return { rows: [currentAppeal] };
      }

      if (
        sql.includes("UPDATE moderation_appeals") &&
        sql.includes("SET status=$2")
      ) {
        currentAppeal = {
          ...(currentAppeal || moderationAppeal()),
          status: params[1],
          reviewed_by_admin: ["ACCEPTED", "REJECTED"].includes(params[1])
            ? params[2]
            : currentAppeal?.reviewed_by_admin || null,
          reviewed_at: ["ACCEPTED", "REJECTED"].includes(params[1])
            ? "2026-06-05T03:00:00.000Z"
            : currentAppeal?.reviewed_at || null,
          decision_note: ["ACCEPTED", "REJECTED"].includes(params[1])
            ? params[3]
            : currentAppeal?.decision_note || null,
          updated_at: "2026-06-05T03:00:00.000Z",
        };
        return { rows: [currentAppeal] };
      }

      if (
        sql.includes("FROM moderation_appeals ma") &&
        sql.includes("WHERE ma.id=$1")
      ) {
        return { rows: currentAppeal ? [currentAppeal] : [] };
      }

      if (
        sql.includes("FROM moderation_appeals ma") &&
        sql.includes("WHERE ma.case_id=$1")
      ) {
        return { rows: currentAppeal ? [currentAppeal] : [] };
      }

      if (
        sql.includes("FROM moderation_appeals ma") &&
        sql.includes("JOIN moderation_cases mc")
      ) {
        return { rows: currentAppeal ? [currentAppeal] : [] };
      }

      if (sql.includes("FROM moderation_appeal_events mae")) {
        return {
          rows: currentAppeal
            ? [
                {
                  id: "appeal-event-1",
                  appeal_id: APPEAL_ID,
                  case_id: CASE_ID,
                  actor_user_id: PROVIDER_ID,
                  actor_name: "Green Kitchen",
                  actor_role: "provider",
                  event_type: "APPEAL_SUBMITTED",
                  from_status: null,
                  to_status: "SUBMITTED",
                  note: null,
                  metadata: {},
                  created_at: "2026-06-05T02:00:00.000Z",
                },
              ]
            : [],
        };
      }

      if (
        sql.includes("FROM provider_case_responses pcr") &&
        sql.includes("WHERE pcr.id=$1")
      ) {
        return { rows: currentResponse ? [currentResponse] : [] };
      }

      if (
        sql.includes("FROM provider_case_responses pcr") &&
        sql.includes("WHERE pcr.case_id=$1")
      ) {
        return { rows: currentResponse ? [currentResponse] : [] };
      }

      if (sql.includes("COUNT(*)::int AS report_count")) {
        return { rows: [{ report_count: 0 }] };
      }

      if (sql.includes("INSERT INTO provider_reports")) {
        return { rows: [providerReport("pending", null)] };
      }

      if (sql.includes("INSERT INTO moderation_cases") && sql.includes("VALUES (")) {
        createdCaseCount += 1;
        currentCase = {
          ...moderationCase(params[1] || "OPEN"),
          id: CASE_ID,
        };
        return { rows: [currentCase] };
      }

      if (sql.includes("UPDATE provider_reports") && sql.includes("moderation_case_id")) {
        return { rows: [] };
      }

      if (sql.includes("FROM moderation_case_events") && sql.includes("CASE_OPENED")) {
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO moderation_appeal_events") && sql.includes("VALUES")) {
        eventCount += 1;
        return {
          rows: [
            {
              id: `appeal-event-${eventCount}`,
              appeal_id: params[0],
              case_id: params[1],
              actor_user_id: params[2],
              event_type: params[3],
              from_status: params[4],
              to_status: params[5],
              note: params[6],
              metadata: JSON.parse(params[7] || "{}"),
              created_at: "2026-06-05T02:00:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("INSERT INTO moderation_case_events") && sql.includes("VALUES")) {
        eventCount += 1;
        return {
          rows: [
            {
              id: `event-${eventCount}`,
              case_id: params[0],
              actor_user_id: params[1],
              event_type: params[2],
              from_status: params[3],
              to_status: params[4],
              note: params[5],
              metadata: JSON.parse(params[6] || "{}"),
              created_at: "2026-06-05T00:00:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("UPDATE provider_reports") && sql.includes("status='validated'")) {
        return { rows: [providerReport("validated")] };
      }

      if (sql.includes("UPDATE provider_reports") && sql.includes("status='dismissed'")) {
        return { rows: [providerReport("dismissed")] };
      }

      if (sql.includes("SELECT *") && sql.includes("FROM moderation_cases")) {
        return { rows: [currentCase] };
      }

      if (sql.includes("UPDATE moderation_cases")) {
        currentCase = {
          ...currentCase,
          status: params[1],
          assigned_admin_id: ADMIN_ID,
          updated_at: "2026-06-05T01:00:00.000Z",
          closed_at: ["VALIDATED", "DISMISSED"].includes(params[1])
            ? "2026-06-05T01:00:00.000Z"
            : null,
        };
        return { rows: [currentCase] };
      }

      if (sql.includes("INSERT INTO trust_events")) {
        return {
          rows: [
            {
              id: "trust-event-1",
              event_key: params[0],
              event_type: params[7],
            },
          ],
        };
      }

      if (sql.includes("FROM moderation_cases mc")) {
        return {
          rows: [
            {
              case_id: CASE_ID,
              case_type: "provider_report",
              subject_type: "provider",
              subject_id: PROVIDER_ID,
              case_status: currentCase.status,
              opened_by_user_id: REPORTER_ID,
              assigned_admin_id: currentCase.assigned_admin_id,
              source_report_id: REPORT_ID,
              case_reason: "unsafe_food",
              case_summary: "Food smelled unsafe.",
              case_created_at: "2026-06-05T00:00:00.000Z",
              case_updated_at: currentCase.updated_at,
              closed_at: currentCase.closed_at,
              provider_name: "Green Kitchen",
              assigned_admin_name: "Admin User",
              report_id: REPORT_ID,
              report_provider_id: PROVIDER_ID,
              reported_by: REPORTER_ID,
              reservation_id: RESERVATION_ID,
              report_reason: "unsafe_food",
              report_description: "Food smelled unsafe.",
              report_status: currentCase.status === "DISMISSED"
                ? "dismissed"
                : currentCase.status === "VALIDATED"
                  ? "validated"
                  : "pending",
              report_created_at: "2026-06-05T00:00:00.000Z",
              resolved_at: currentCase.closed_at,
              reviewed_by_admin: currentCase.assigned_admin_id,
              reporter_name: "Helping NGO",
              reporter_role: "ngo",
              reservation_pickup_type: "ngo",
              reservation_status: "completed",
              reservation_task_status: "delivered",
              listing_title: "Lunch boxes",
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

      if (sql.includes("FROM moderation_case_events mce")) {
        return {
          rows: [
            {
              id: "event-1",
              case_id: CASE_ID,
              actor_user_id: REPORTER_ID,
              actor_name: "Helping NGO",
              actor_role: "ngo",
              event_type: "CASE_OPENED",
              from_status: null,
              to_status: "OPEN",
              note: null,
              metadata: {},
              created_at: "2026-06-05T00:00:00.000Z",
            },
          ],
        };
      }

      return { rows: [] };
    },
    get createdCaseCount() {
      return createdCaseCount;
    },
  };
}

test("provider report creation opens a linked moderation case with timeline", async () => {
  const client = createClient();

  const report = await createProviderReport({
    client,
    providerId: PROVIDER_ID,
    reportedBy: REPORTER_ID,
    reservationId: RESERVATION_ID,
    reason: "unsafe_food",
    description: "Food smelled unsafe.",
    applyCooldown: false,
  });

  assert.equal(report.moderation_case_id, CASE_ID);
  assert.equal(report.moderation_case_status, "OPEN");
  assert.equal(client.createdCaseCount, 1);
  assert.ok(client.calls.some((call) => call.sql.includes("INSERT INTO moderation_cases")));
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_case_events") &&
        call.params[2] === "CASE_OPENED"
    )
  );
});

test("moderation case status transition writes audit history", async () => {
  const client = createClient();

  const updated = await transitionModerationCaseStatus({
    client,
    caseId: CASE_ID,
    adminId: ADMIN_ID,
    status: "UNDER_REVIEW",
    note: "Checking evidence.",
  });

  assert.equal(updated.status, "UNDER_REVIEW");
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_case_events") &&
        call.params[2] === "CASE_STATUS_CHANGED" &&
        call.params[3] === "OPEN" &&
        call.params[4] === "UNDER_REVIEW" &&
        call.params[5] === "Checking evidence."
    )
  );
});

test("validated provider report preserves trust penalty path and closes case", async () => {
  const client = createClient();

  const report = await validateProviderReport({
    client,
    reportId: REPORT_ID,
    adminId: ADMIN_ID,
  });

  assert.equal(report.status, "validated");
  assert.equal(report.moderation_case_status, "VALIDATED");
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO trust_events") &&
        call.params[7] === "provider_report_validated"
    )
  );
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_case_events") &&
        call.params[4] === "VALIDATED"
    )
  );
});

test("dismissed provider report closes case without trust penalty event", async () => {
  const client = createClient();

  const report = await dismissProviderReport({
    client,
    reportId: REPORT_ID,
    adminId: ADMIN_ID,
  });

  assert.equal(report.status, "dismissed");
  assert.equal(report.moderation_case_status, "DISMISSED");
  assert.equal(
    client.calls.some((call) => call.sql.includes("INSERT INTO trust_events")),
    false
  );
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_case_events") &&
        call.params[4] === "DISMISSED"
    )
  );
});

test("moderation case detail includes linked report, attachments, and timeline", async () => {
  const client = createClient();

  const detail = await getModerationCaseDetail({ client, caseId: CASE_ID });

  assert.equal(detail.id, CASE_ID);
  assert.equal(detail.report.id, REPORT_ID);
  assert.equal(detail.report.attachments.length, 1);
  assert.equal(detail.events.length, 1);
  assert.equal(detail.events[0].event_type, "CASE_OPENED");
});

test("provider response creates immutable moderation timeline event", async () => {
  const client = createClient({ caseStatus: "AWAITING_RESPONSE" });

  const response = await submitProviderCaseResponse({
    client,
    caseId: CASE_ID,
    providerId: PROVIDER_ID,
    responseText: "Batch was sealed and handed over on time.",
    files: [],
  });

  assert.equal(response.id, RESPONSE_ID);
  assert.equal(response.response_text, "Batch was sealed and handed over on time.");
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_case_events") &&
        call.params[2] === "CASE_PROVIDER_RESPONSE_SUBMITTED" &&
        JSON.parse(call.params[6]).attachment_count === 0
    )
  );
});

test("provider response rejects providers that do not own the case", async () => {
  const client = createClient({ caseStatus: "AWAITING_RESPONSE" });

  await assert.rejects(
    () =>
      submitProviderCaseResponse({
        client,
        caseId: CASE_ID,
        providerId: REPORTER_ID,
        responseText: "I should not be able to answer this case.",
        files: [],
      }),
    (err) => err.statusCode === 403
  );
});

test("provider response is read-only after terminal case decision", async () => {
  const client = createClient({ caseStatus: "VALIDATED" });

  await assert.rejects(
    () =>
      submitProviderCaseResponse({
        client,
        caseId: CASE_ID,
        providerId: PROVIDER_ID,
        responseText: "Trying to update a closed case.",
        files: [],
      }),
    (err) => err.statusCode === 409
  );
});

test("provider response rejects attachments beyond three total images", async () => {
  const client = createClient({
    caseStatus: "AWAITING_RESPONSE",
    existingResponse: true,
    responseAttachmentCount: 3,
  });

  await assert.rejects(
    () =>
      submitProviderCaseResponse({
        client,
        caseId: CASE_ID,
        providerId: PROVIDER_ID,
        responseText: "Adding one more image should fail.",
        files: [{ originalname: "extra.webp" }],
      }),
    (err) => err.statusCode === 400
  );
});

test("moderation case detail includes provider response and evidence", async () => {
  const client = createClient({
    existingResponse: true,
    responseAttachmentCount: 1,
  });

  const detail = await getModerationCaseDetail({ client, caseId: CASE_ID });

  assert.equal(detail.provider_response.id, RESPONSE_ID);
  assert.equal(detail.provider_response.attachments.length, 1);
  assert.equal(detail.provider_responses.length, 1);
});

test("provider appeal is allowed only after terminal moderation decisions", async () => {
  const client = createClient({ caseStatus: "VALIDATED" });

  const appeal = await submitProviderModerationAppeal({
    client,
    caseId: CASE_ID,
    providerId: PROVIDER_ID,
    appealText: "The delivery evidence shows the report should be reconsidered.",
    files: [],
  });

  assert.equal(appeal.id, APPEAL_ID);
  assert.equal(appeal.status, "SUBMITTED");
  assert.equal(
    client.calls.some((call) => call.sql.includes("INSERT INTO trust_events")),
    false
  );
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_appeal_events") &&
        call.params[3] === "APPEAL_SUBMITTED"
    )
  );
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_case_events") &&
        call.params[2] === "CASE_APPEAL_SUBMITTED"
    )
  );
});

test("provider appeal rejects active cases, duplicate appeals, and non-owners", async () => {
  await assert.rejects(
    () =>
      submitProviderModerationAppeal({
        client: createClient({ caseStatus: "UNDER_REVIEW" }),
        caseId: CASE_ID,
        providerId: PROVIDER_ID,
        appealText: "Appealing too early.",
        files: [],
      }),
    (err) => err.statusCode === 409
  );

  await assert.rejects(
    () =>
      submitProviderModerationAppeal({
        client: createClient({ caseStatus: "VALIDATED", existingAppeal: true }),
        caseId: CASE_ID,
        providerId: PROVIDER_ID,
        appealText: "Second appeal.",
        files: [],
      }),
    (err) => err.statusCode === 409
  );

  await assert.rejects(
    () =>
      submitProviderModerationAppeal({
        client: createClient({ caseStatus: "VALIDATED" }),
        caseId: CASE_ID,
        providerId: REPORTER_ID,
        appealText: "Wrong owner.",
        files: [],
      }),
    (err) => err.statusCode === 403
  );
});

test("provider appeal withdrawal writes appeal and case audit events", async () => {
  const client = createClient({
    caseStatus: "VALIDATED",
    existingAppeal: true,
  });

  const appeal = await withdrawProviderModerationAppeal({
    client,
    caseId: CASE_ID,
    providerId: PROVIDER_ID,
  });

  assert.equal(appeal.status, "WITHDRAWN");
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_appeal_events") &&
        call.params[3] === "APPEAL_WITHDRAWN" &&
        call.params[5] === "WITHDRAWN"
    )
  );
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_case_events") &&
        call.params[2] === "CASE_APPEAL_WITHDRAWN"
    )
  );
});

test("admin appeal acceptance records audit without direct trust mutation", async () => {
  const client = createClient({
    caseStatus: "VALIDATED",
    existingAppeal: true,
  });

  const appeal = await transitionModerationAppealStatus({
    client,
    appealId: APPEAL_ID,
    adminId: ADMIN_ID,
    status: "ACCEPTED",
    note: "Provider evidence is credible.",
  });

  assert.equal(appeal.status, "ACCEPTED");
  assert.equal(
    client.calls.some((call) => call.sql.includes("INSERT INTO trust_events")),
    false
  );
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_appeal_events") &&
        call.params[3] === "APPEAL_STATUS_CHANGED" &&
        call.params[5] === "ACCEPTED"
    )
  );
  assert.ok(
    client.calls.some(
      (call) =>
        call.sql.includes("INSERT INTO moderation_case_events") &&
        call.params[2] === "CASE_APPEAL_STATUS_CHANGED" &&
        JSON.parse(call.params[6]).appeal_to_status === "ACCEPTED"
    )
  );
});

test("terminal appeals cannot be changed by provider or admin", async () => {
  await assert.rejects(
    () =>
      withdrawProviderModerationAppeal({
        client: createClient({
          caseStatus: "VALIDATED",
          existingAppeal: true,
          appealStatus: "ACCEPTED",
        }),
        caseId: CASE_ID,
        providerId: PROVIDER_ID,
      }),
    (err) => err.statusCode === 409
  );

  await assert.rejects(
    () =>
      transitionModerationAppealStatus({
        client: createClient({
          caseStatus: "VALIDATED",
          existingAppeal: true,
          appealStatus: "REJECTED",
        }),
        appealId: APPEAL_ID,
        adminId: ADMIN_ID,
        status: "UNDER_REVIEW",
      }),
    (err) => err.statusCode === 409
  );
});

test("moderation case detail and admin appeal queue include appeal history", async () => {
  const client = createClient({
    caseStatus: "VALIDATED",
    existingAppeal: true,
    appealAttachmentCount: 1,
  });

  const detail = await getModerationCaseDetail({ client, caseId: CASE_ID });
  const appeals = await listModerationAppeals({ client, status: "open" });

  assert.equal(detail.appeal.id, APPEAL_ID);
  assert.equal(detail.appeal.attachments.length, 1);
  assert.equal(detail.appeal.events[0].event_type, "APPEAL_SUBMITTED");
  assert.equal(appeals[0].id, APPEAL_ID);
});
