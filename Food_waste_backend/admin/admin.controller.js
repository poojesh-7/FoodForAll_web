const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");
const { isValidId } = require("../utils/validation");
const expiryQueue = require("../queues/expiry.queue");
const expiryAlertQueue = require("../queues/expiryAlert.queue");
const pickupQueue = require("../queues/pickup.queue");
const deliveryQueue = require("../queues/delivery.queue");
const notificationQueue = require("../queues/notification.queue");
const paymentQueue = require("../queues/payment.queue");
const refundQueue = require("../queues/refund.queue");
const {
  dismissProviderReport,
  listProviderReports,
  validateProviderReport,
} = require("../shared/services/moderation.service");

const monitoredQueues = [
  expiryQueue,
  expiryAlertQueue,
  pickupQueue,
  deliveryQueue,
  notificationQueue,
  paymentQueue,
  refundQueue,
];

//
// 📌 GET PENDING NGOS
//
exports.getPendingNGOs = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT n.*, u.phone
      FROM ngos n
      JOIN users u ON n.user_id = u.id
      WHERE n.is_verified = false
    `);

    res.json(result.rows);

  } catch (err) {
    logger.error("Failed to fetch pending NGOs", { err, adminId: req.user?.id });
    res.status(500).json({ error: "Failed to fetch NGOs" });
  }
};

//
// 📌 APPROVE NGO
//
exports.approveNGO = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ error: "NGO id is required" });
    }

    const result = await pool.query(
      `
      UPDATE ngos
      SET is_verified=true, rejection_reason=NULL
      WHERE id=$1 AND is_verified=false
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({ error: "NGO not found or already approved" });
    }

    res.json({ message: "NGO approved" });

  } catch (err) {
    logger.error("NGO approval failed", { err, adminId: req.user?.id, ngoId: req.params.id });
    res.status(500).json({ error: "Approval failed" });
  }
};

//
// 📌 REJECT NGO
//
exports.rejectNGO = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: "NGO id is required" });
    }

    const rejectionReason = String(reason || "Rejected by admin").trim().slice(0, 500);
    const result = await pool.query(
      `UPDATE ngos SET is_verified=false, rejection_reason=$1 WHERE id=$2`,
      [rejectionReason || "Rejected by admin", id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "NGO not found" });
    }

    res.json({ message: "NGO rejected" });

  } catch (err) {
    logger.error("NGO rejection failed", { err, adminId: req.user?.id, ngoId: req.params.id });
    res.status(500).json({ error: "Rejection failed" });
  }
};

//
// 📌 GET PENDING RESTAURANTS
//
exports.getPendingRestaurants = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, u.phone
      FROM restaurants r
      JOIN users u ON r.user_id = u.id
      WHERE r.is_verified = false
    `);

    res.json(result.rows);

  } catch (err) {
    logger.error("Failed to fetch pending restaurants", { err, adminId: req.user?.id });
    res.status(500).json({ error: "Failed to fetch restaurants" });
  }
};

//
// 📌 APPROVE RESTAURANT
//
exports.approveRestaurant = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ error: "Restaurant id is required" });
    }

    const result = await pool.query(
      `
      UPDATE restaurants
      SET is_verified=true, rejection_reason=NULL
      WHERE id=$1 AND is_verified=false
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({ error: "Restaurant not found or already approved" });
    }

    res.json({ message: "Restaurant approved" });

  } catch (err) {
    logger.error("Restaurant approval failed", {
      err,
      adminId: req.user?.id,
      restaurantId: req.params.id,
    });
    res.status(500).json({ error: "Approval failed" });
  }
};

//
// 📌 REJECT RESTAURANT
//
exports.rejectRestaurant = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ error: "Restaurant id is required" });
    }

    const rejectionReason = String(reason || "Rejected by admin").trim().slice(0, 500);
    const result = await pool.query(
      `UPDATE restaurants SET is_verified=false, rejection_reason=$1 WHERE id=$2`,
      [rejectionReason || "Rejected by admin", id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    res.json({ message: "Restaurant rejected" });

  } catch (err) {
    logger.error("Restaurant rejection failed", {
      err,
      adminId: req.user?.id,
      restaurantId: req.params.id,
    });
    res.status(500).json({ error: "Rejection failed" });
  }
};

//
// GET OPERATIONAL SUMMARY
//
exports.getOperationalSummary = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM ngos) AS total_ngos,
        (SELECT COUNT(*)::int FROM restaurants) AS total_restaurants,
        (
          SELECT COUNT(*)::int
          FROM reservations
          WHERE status IN ('reserved', 'picked_up')
        ) AS active_reservations,
        (
          SELECT COUNT(*)::int
          FROM reservations
          WHERE status = 'expired'
        ) AS expired_reservations,
        (
          SELECT COUNT(DISTINCT user_id)::int
          FROM volunteers
          WHERE status = 'active'
        ) AS active_volunteers
    `);

    res.json(result.rows[0]);
  } catch (err) {
    logger.error("Failed to fetch operational summary", { err, adminId: req.user?.id });
    res.status(500).json({ error: "Failed to fetch operational summary" });
  }
};

//
// GET QUEUE HEALTH
//
exports.getQueueHealth = async (req, res) => {
  try {
    const queues = await Promise.all(
      monitoredQueues.map(async (queue) => {
        const [counts, isPaused] = await Promise.all([
          queue.getJobCounts(
            "active",
            "waiting",
            "delayed",
            "failed",
            "completed",
            "paused"
          ),
          queue.isPaused(),
        ]);

        return {
          name: queue.name,
          is_paused: isPaused,
          counts,
        };
      })
    );

    res.json({ queues });
  } catch (err) {
    logger.error("Failed to fetch queue health", { err, adminId: req.user?.id });
    res.status(500).json({
      success: false,
      message: "Failed to fetch queue health",
      error: "Failed to fetch queue health",
      data: null,
    });
  }
};

exports.getProviderReports = async (req, res) => {
  try {
    const reports = await listProviderReports({
      status: req.query.status === "all" ? null : req.query.status || "pending",
    });
    res.json({ reports });
  } catch (err) {
    logger.error("Failed to fetch provider reports", { err, adminId: req.user?.id });
    res.status(500).json({ error: "Failed to fetch provider reports" });
  }
};

async function reviewProviderReport(req, res, action) {
  const { id } = req.params;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Report id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const report =
      action === "validate"
        ? await validateProviderReport({ client, reportId: id, adminId: req.user.id })
        : await dismissProviderReport({ client, reportId: id, adminId: req.user.id });

    if (!report) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Pending report not found" });
    }

    await client.query("COMMIT");
    res.json({ message: `Provider report ${action}d`, report });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Provider report review failed", {
      err,
      adminId: req.user?.id,
      reportId: id,
      action,
    });
    res.status(500).json({ error: "Provider report review failed" });
  } finally {
    client.release();
  }
}

exports.validateProviderReport = (req, res) =>
  reviewProviderReport(req, res, "validate");

exports.dismissProviderReport = (req, res) =>
  reviewProviderReport(req, res, "dismiss");
