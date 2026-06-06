const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");
const { isValidId } = require("../utils/validation");
const {
  getProviderModerationCaseDetail,
  listProviderModerationCases,
  submitProviderModerationAppeal,
  submitProviderCaseResponse,
  withdrawProviderModerationAppeal,
} = require("../shared/services/moderation.service");
const {
  notifyAdminsAppealSubmitted,
  notifyAdminsAppealWithdrawn,
  notifyAdminsProviderResponseSubmitted,
} = require("../shared/services/moderationNotification.service");
const {
  recordOperationalEvent,
} = require("../shared/services/observability.service");

exports.listMyModerationCases = async (req, res) => {
  try {
    const cases = await listProviderModerationCases({
      providerId: req.user.id,
    });
    res.json({ cases });
  } catch (err) {
    logger.error("Failed to fetch provider moderation cases", {
      err,
      providerId: req.user?.id,
    });
    res.status(err.statusCode || 500).json({
      error: "Failed to fetch moderation cases",
    });
  }
};

exports.getMyModerationCase = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Moderation case id is required" });
  }

  try {
    const moderationCase = await getProviderModerationCaseDetail({
      caseId: id,
      providerId: req.user.id,
    });

    if (!moderationCase) {
      return res.status(404).json({ error: "Moderation case not found" });
    }

    res.json({ case: moderationCase });
  } catch (err) {
    logger.error("Failed to fetch provider moderation case", {
      err,
      providerId: req.user?.id,
      caseId: id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to fetch moderation case",
    });
  }
};

exports.submitMyModerationCaseResponse = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Moderation case id is required" });
  }

  const responseText = req.body?.response_text || req.body?.responseText;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const response = await submitProviderCaseResponse({
      client,
      caseId: id,
      providerId: req.user.id,
      responseText,
      files: req.files || [],
    });

    if (!response) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Moderation case not found" });
    }

    const moderationCase = await getProviderModerationCaseDetail({
      client,
      caseId: id,
      providerId: req.user.id,
    });

    await client.query("COMMIT");

    void notifyAdminsProviderResponseSubmitted({
      caseId: id,
      providerId: req.user.id,
      responseId: response.id,
      attachmentCount: Array.isArray(response.attachments)
        ? response.attachments.length
        : 0,
    });

    logger.security("Provider submitted moderation case response", {
      providerId: req.user?.id,
      caseId: id,
      responseId: response.id,
      attachmentCount: Array.isArray(response.attachments)
        ? response.attachments.length
        : 0,
    });
    void recordOperationalEvent({
      category: "security",
      severity: "info",
      eventName: "provider_moderation_case_response_submitted",
      metadata: {
        providerId: req.user?.id,
        caseId: id,
        responseId: response.id,
      },
    });

    res.status(201).json({
      message: "Provider response submitted",
      response,
      case: moderationCase,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Provider moderation case response failed", {
      err,
      providerId: req.user?.id,
      caseId: id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Provider response failed",
    });
  } finally {
    client.release();
  }
};

exports.submitMyModerationCaseAppeal = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Moderation case id is required" });
  }

  const appealText = req.body?.appeal_text || req.body?.appealText;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const appeal = await submitProviderModerationAppeal({
      client,
      caseId: id,
      providerId: req.user.id,
      appealText,
      files: req.files || [],
    });

    if (!appeal) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Moderation case not found" });
    }

    const moderationCase = await getProviderModerationCaseDetail({
      client,
      caseId: id,
      providerId: req.user.id,
    });

    await client.query("COMMIT");

    void notifyAdminsAppealSubmitted({
      caseId: id,
      providerId: req.user.id,
      appealId: appeal.id,
      attachmentCount: Array.isArray(appeal.attachments)
        ? appeal.attachments.length
        : 0,
    });

    logger.security("Provider submitted moderation appeal", {
      providerId: req.user?.id,
      caseId: id,
      appealId: appeal.id,
      attachmentCount: Array.isArray(appeal.attachments)
        ? appeal.attachments.length
        : 0,
    });
    void recordOperationalEvent({
      category: "security",
      severity: "info",
      eventName: "provider_moderation_appeal_submitted",
      metadata: {
        providerId: req.user?.id,
        caseId: id,
        appealId: appeal.id,
      },
    });

    res.status(201).json({
      message: "Appeal submitted",
      appeal,
      case: moderationCase,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Provider moderation appeal submission failed", {
      err,
      providerId: req.user?.id,
      caseId: id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Appeal submission failed",
    });
  } finally {
    client.release();
  }
};

exports.withdrawMyModerationCaseAppeal = async (req, res) => {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Moderation case id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const appeal = await withdrawProviderModerationAppeal({
      client,
      caseId: id,
      providerId: req.user.id,
      note: req.body?.note,
    });

    if (!appeal) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Appeal not found" });
    }

    const moderationCase = await getProviderModerationCaseDetail({
      client,
      caseId: id,
      providerId: req.user.id,
    });

    await client.query("COMMIT");

    void notifyAdminsAppealWithdrawn({
      caseId: id,
      providerId: req.user.id,
      appealId: appeal.id,
    });

    logger.security("Provider withdrew moderation appeal", {
      providerId: req.user?.id,
      caseId: id,
      appealId: appeal.id,
    });
    void recordOperationalEvent({
      category: "security",
      severity: "info",
      eventName: "provider_moderation_appeal_withdrawn",
      metadata: {
        providerId: req.user?.id,
        caseId: id,
        appealId: appeal.id,
      },
    });

    res.json({
      message: "Appeal withdrawn",
      appeal,
      case: moderationCase,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Provider moderation appeal withdrawal failed", {
      err,
      providerId: req.user?.id,
      caseId: id,
    });
    res.status(err.statusCode || 500).json({
      error: err.message || "Appeal withdrawal failed",
    });
  } finally {
    client.release();
  }
};
