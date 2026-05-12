const pool = require("../shared/config/db");
const pickupQueue = require("../queues/pickup.queue");
const deliveryQueue = require("../queues/delivery.queue");
const notificationQueue = require("../queues/notification.queue");
const {
  publishReservationUpdated,
  publishTaskAvailabilityUpdated,
  publishToUsers,
  publishVolunteerUpdated,
} = require("../shared/services/realtime.service");
const {
  ensureVolunteerRequestSchema,
} = require("../shared/services/volunteerRequestSchema.service");
const logger = require("../shared/utils/logger");
const {
  isProvided,
  isNumberInRange,
  isValidId,
  isValidLatitude,
  isValidLongitude,
  toNumber,
} = require("../utils/validation");

const withStatus = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// 🔍 View NGOs
exports.viewAvailableNGOs = async (req, res) => {
  if (req.user.role !== "volunteer")
    return res.status(403).json({ error: "Access denied" });

  await ensureVolunteerRequestSchema();

  const result = await pool.query(
    `
    SELECT n.id,
           n.organization_name,
           n.urgent_flag,
           COUNT(DISTINCT f.id) FILTER (WHERE f.status='active') AS active_listings,
           COUNT(DISTINCT v.user_id) FILTER (WHERE v.status='active') AS total_volunteers,
           COALESCE(MAX(vself.status), MAX(vrself.status)) AS volunteer_status
    FROM ngos n
    LEFT JOIN food_listings f ON f.ngo_id=n.id
    LEFT JOIN volunteers v ON v.ngo_id=n.id
    LEFT JOIN volunteers vself
      ON vself.ngo_id=n.id
      AND vself.user_id=$1
      AND vself.status='active'
    LEFT JOIN volunteer_requests vrself
      ON vrself.ngo_id=n.id
      AND vrself.volunteer_id=$1
      AND vrself.request_type='volunteer_join'
      AND vrself.id = (
        SELECT latest_vr.id
        FROM volunteer_requests latest_vr
        WHERE latest_vr.ngo_id=n.id
        AND latest_vr.volunteer_id=$1
        AND latest_vr.request_type='volunteer_join'
        ORDER BY latest_vr.requested_at DESC NULLS LAST, latest_vr.id DESC
        LIMIT 1
      )
    GROUP BY n.id
    ORDER BY n.urgent_flag DESC, active_listings DESC
  `,
    [req.user.id],
  );

  res.json(result.rows);
};

exports.getDashboard = async (req, res) => {
  if (req.user.role !== "volunteer")
    return res.status(403).json({ error: "Only volunteers allowed" });

  try {
    await ensureVolunteerRequestSchema();

    const [activeNGO, currentTask, stats, pendingRequests] = await Promise.all([
      pool.query(
        `
        SELECT n.id,
               n.organization_name,
               n.urgent_flag,
               v.status AS volunteer_status,
               COUNT(DISTINCT f.id) FILTER (WHERE f.status='active') AS active_listings,
               COUNT(DISTINCT active_v.user_id) FILTER (WHERE active_v.status='active') AS total_volunteers
        FROM volunteers v
        JOIN ngos n ON n.id=v.ngo_id
        LEFT JOIN food_listings f ON f.ngo_id=n.id
        LEFT JOIN volunteers active_v ON active_v.ngo_id=n.id
        WHERE v.user_id=$1
        AND v.status='active'
        GROUP BY n.id, v.status
        ORDER BY n.urgent_flag DESC, n.id DESC
        LIMIT 1
        `,
        [req.user.id],
      ),
      pool.query(
        `
        SELECT
          r.id AS reservation_id,
          r.quantity_reserved,
          r.pickup_type,
          r.status,
          r.task_status,
          r.pickup_code,
          r.assigned_at,
          r.picked_up_at,
          r.completed_at,
          f.id AS listing_id,
          f.title,
          f.latitude,
          f.longitude,
          f.latitude AS restaurant_latitude,
          f.longitude AS restaurant_longitude,
          f.pickup_start_time,
          f.pickup_end_time,
          u.id AS provider_id,
          u.name AS provider_name,
          u.phone AS provider_phone,
          n.organization_name AS ngo_name,
          n.latitude AS ngo_latitude,
          n.longitude AS ngo_longitude
        FROM reservations r
        JOIN food_listings f ON f.id=r.listing_id
        JOIN users u ON u.id=f.provider_id
        JOIN ngos n ON n.user_id=r.user_id
        WHERE r.assigned_volunteer_id=$1
        AND r.task_status IN ('in_progress','picked_from_provider')
        ORDER BY r.assigned_at DESC
        LIMIT 1
        `,
        [req.user.id],
      ),
      pool.query(
        `
        SELECT total_completed, avg_completion_time
        FROM volunteer_stats
        WHERE volunteer_id=$1
        `,
        [req.user.id],
      ),
      pool.query(
        `
        SELECT vr.*, n.organization_name
        FROM volunteer_requests vr
        JOIN ngos n ON vr.ngo_id=n.id
        WHERE vr.volunteer_id=$1
        AND vr.status='pending'
        AND vr.request_type='ngo_invite'
        ORDER BY vr.requested_at DESC NULLS LAST, vr.id DESC
        `,
        [req.user.id],
      ),
    ]);

    res.json({
      active_ngo: activeNGO.rows[0] || null,
      current_task: currentTask.rows[0] || null,
      stats: stats.rows[0] || {
        total_completed: 0,
        avg_completion_time: 0,
      },
      pending_requests: pendingRequests.rows,
    });
  } catch (err) {
    logger.error("Failed to fetch volunteer dashboard", {
      err,
      userId: req.user?.id,
    });
    res.status(500).json({ error: "Failed to fetch volunteer dashboard" });
  }
};

// 📬 View NGO requests
exports.viewRequests = async (req, res) => {
  await ensureVolunteerRequestSchema();

  const result = await pool.query(
    `
    SELECT vr.*, n.organization_name
    FROM volunteer_requests vr
    JOIN ngos n ON vr.ngo_id=n.id
    WHERE vr.volunteer_id=$1
    AND vr.status='pending'
    AND vr.request_type='ngo_invite'
    `,
    [req.user.id],
  );

  res.json(result.rows);
};

// ✅ Respond to request
exports.respondToRequest = async (req, res) => {
  if (req.user.role !== "volunteer")
    return res.status(403).json({ error: "Access denied" });

  const { action } = req.body;
  const requestId = req.params.id;

  if (!isValidId(requestId)) {
    return res.status(400).json({ error: "Request id is required" });
  }

  if (!["accepted", "rejected"].includes(action))
    return res.status(400).json({ error: "Invalid action" });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureVolunteerRequestSchema(client);

    // 1️⃣ Fetch request safely
    const request = await client.query(
      `
      SELECT * FROM volunteer_requests
      WHERE id=$1
      AND volunteer_id=$2
      AND status='pending'
      AND request_type='ngo_invite'
      FOR UPDATE
      `,
      [requestId, req.user.id],
    );

    if (!request.rows.length)
      throw withStatus("Request not found or already handled", 409);
    // id in ngos table
    const { ngo_id } = request.rows[0];

    // 2️⃣ Update request status
    await client.query(
      `
      UPDATE volunteer_requests
      SET status=$1,
          responded_at=NOW()
      WHERE id=$2
      `,
      [action === "accepted" ? "approved" : "rejected", requestId],
    );

    // 3️⃣ If accepted → activate volunteer membership
    if (action === "accepted") {
      await client.query(
        `
        INSERT INTO volunteers (user_id, ngo_id, status)
        VALUES ($1,$2,'active')
        ON CONFLICT (user_id, ngo_id)
        DO UPDATE SET status='active'
        `,
        [req.user.id, ngo_id],
      );

      const ngoUser = await pool.query(`SELECT user_id FROM ngos WHERE id=$1`, [
        ngo_id,
      ]);

      if (ngoUser.rows.length) {
        const ngoUserId = ngoUser.rows[0].user_id;

        await notificationQueue.add("notify-user", {
          userId: ngoUserId,
          type: "volunteer_accept_request",
          title: "Volunteer Response",
          message: "Volunteer accepted your request to join",
        });
      }
    } else {
      const ngoUser = await pool.query(`SELECT user_id FROM ngos WHERE id=$1`, [
        ngo_id,
      ]);

      if (ngoUser.rows.length) {
        const ngoUserId = ngoUser.rows[0].user_id;

        await notificationQueue.add("notify-user", {
          userId: ngoUserId,
          type: "volunteer_reject_request",
          title: "Volunteer Response",
          message: "Volunteer rejected your request"
        });
      }
    }

    await client.query("COMMIT");

    // 4️⃣ Notify NGO (optional but recommended)
    const ngoUser = await pool.query(`SELECT user_id FROM ngos WHERE id=$1`, [
      ngo_id,
    ]);

    if (ngoUser.rows.length) {
      const ngoUserId = ngoUser.rows[0].user_id;

      const io = req.app.get("io");
      io?.to(`user:${ngoUserId}`).emit("volunteer:request_response", {
        volunteer_id: req.user.id,
        action,
      });
      await publishToUsers([ngoUserId, req.user.id], "volunteer_updated", {
        action: `request_${action}`,
        volunteer: {
          id: req.user.id,
          status: action,
        },
      });
    }

    res.json({ message: `Request ${action}` });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(err.statusCode || 400).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.joinNGO = async (req, res) => {
  if (req.user.role !== "volunteer")
    return res.status(403).json({ error: "Only volunteers allowed" });

  const { ngo_id } = req.body;

  if (!isValidId(ngo_id)) {
    return res.status(400).json({ error: "NGO id is required" });
  }

  try {
    const existing = await pool.query(
      `
      SELECT * FROM volunteers
      WHERE user_id=$1 AND ngo_id=$2
      `,
      [req.user.id, ngo_id],
    );

    // Case 1️⃣ Already active
    if (existing.rows.length && existing.rows[0].status === "active") {
      return res.status(409).json({ error: "Already joined NGO" });
    }

    // Case 2️⃣ Previously left → reactivate
    if (existing.rows.length && existing.rows[0].status === "left") {
      const updated = await pool.query(
        `
        UPDATE volunteers
        SET status='active'
        WHERE user_id=$1 AND ngo_id=$2
        RETURNING *
        `,
        [req.user.id, ngo_id],
      );

      return res.status(200).json(updated.rows[0]);
    }

    // Case 3️⃣ No record → create new
    const result = await pool.query(
      `
      INSERT INTO volunteers (user_id, ngo_id, status)
      VALUES ($1,$2,'active')
      RETURNING *
      `,
      [req.user.id, ngo_id],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error("Direct volunteer join failed", {
      err,
      userId: req.user?.id,
      ngoId: ngo_id,
    });
    res.status(500).json({ error: "Failed to join NGO" });
  }
};

// 🚪 Leave NGO
exports.joinNGO = async (req, res) => {
  if (req.user.role !== "volunteer")
    return res.status(403).json({ error: "Only volunteers allowed" });

  const { ngo_id } = req.body;

  if (!isValidId(ngo_id)) {
    return res.status(400).json({ error: "NGO id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureVolunteerRequestSchema(client);

    const ngo = await client.query(
      `SELECT id, user_id, organization_name FROM ngos WHERE id=$1`,
      [ngo_id],
    );

    if (!ngo.rows.length) throw withStatus("NGO not found", 404);

    const existing = await client.query(
      `
      SELECT id
      FROM volunteers
      WHERE user_id=$1 AND ngo_id=$2
      AND status='active'
      LIMIT 1
      `,
      [req.user.id, ngo_id],
    );

    if (existing.rows.length) throw withStatus("Already joined NGO", 409);

    const pending = await client.query(
      `
      SELECT id
      FROM volunteer_requests
      WHERE ngo_id=$1
      AND volunteer_id=$2
      AND request_type='volunteer_join'
      AND status='pending'
      LIMIT 1
      `,
      [ngo_id, req.user.id],
    );

    if (pending.rows.length)
      throw withStatus("Join request already pending", 409);

    const recentHandledRequest = await client.query(
      `
      SELECT id, status
      FROM volunteer_requests
      WHERE ngo_id=$1
      AND volunteer_id=$2
      AND request_type='volunteer_join'
      AND status IN ('approved', 'rejected')
      AND COALESCE(responded_at, requested_at) > NOW() - INTERVAL '1 hour'
      ORDER BY COALESCE(responded_at, requested_at) DESC
      LIMIT 1
      `,
      [ngo_id, req.user.id],
    );

    if (recentHandledRequest.rows.length) {
      throw withStatus("Please wait before sending another join request", 429);
    }

    const result = await client.query(
      `
      INSERT INTO volunteer_requests (ngo_id, volunteer_id, status, request_type)
      VALUES ($1,$2,'pending','volunteer_join')
      RETURNING *
      `,
      [ngo_id, req.user.id],
    );

    await client.query("COMMIT");

    await notificationQueue.add("notify-user", {
      userId: ngo.rows[0].user_id,
      type: "volunteer_join_requested",
      title: "Volunteer Join Request",
      message: "A volunteer requested to join your NGO",
    });

    await publishToUsers([ngo.rows[0].user_id, req.user.id], "volunteer_updated", {
      action: "join_request_pending",
      volunteer: {
        id: req.user.id,
        ngo_id,
        status: "pending",
        request_id: result.rows[0].id,
      },
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Volunteer join request failed", { err, userId: req.user?.id, ngoId: ngo_id });
    res.status(err.statusCode || 500).json({
      error: err.statusCode ? err.message : "Failed to request NGO join",
    });
  } finally {
    client.release();
  }
};

exports.leaveNGO = async (req, res) => {
  if (req.user.role !== "volunteer")
    return res.status(403).json({ error: "Only volunteers allowed" });

  const { ngo_id } = req.body;

  if (!isValidId(ngo_id)) {
    return res.status(400).json({ error: "NGO id is required" });
  }

  const activeTasks = await pool.query(
    `
    SELECT COUNT(*)
    FROM reservations
    WHERE assigned_volunteer_id=$1
    AND task_status IN ('assigned','in_progress')
    `,
    [req.user.id],
  );

  if (parseInt(activeTasks.rows[0].count) > 0)
    return res.status(400).json({ error: "Complete tasks first" });

  await pool.query(
    `
    UPDATE volunteers
    SET status='left'
    WHERE user_id=$1 AND ngo_id=$2
    `,
    [req.user.id, ngo_id],
  );

  res.json({ message: "Left NGO successfully" });
};



exports.startTask = async (req, res) => {
  if (req.user.role !== "volunteer")
    return res.status(403).json({ error: "Only volunteers allowed" });

  const { id } = req.params;
  const volunteerId = req.user.id;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Task id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔒 Check active task
    const activeTask = await client.query(
      `
      SELECT id
      FROM reservations
      WHERE assigned_volunteer_id=$1
      AND task_status IN ('in_progress','picked_from_provider')
      `,
      [volunteerId]
    );

    if (activeTask.rows.length)
      throw withStatus("Finish current task before taking another", 409);

    // 🔒 Lock reservation
    const reservationResult = await client.query(
      `
      SELECT *
      FROM reservations
      WHERE id=$1
      FOR UPDATE
      `,
      [id]
    );

    if (!reservationResult.rows.length)
      throw withStatus("Reservation not found", 404);

    const reservation = reservationResult.rows[0];

    if (reservation.task_status !== "pending")
      throw withStatus("Task already taken", 409);

    // ✅ Assign task
    const update = await client.query(
      `
      UPDATE reservations
      SET assigned_volunteer_id=$1,
          task_status='in_progress',
          assigned_at=NOW()
      WHERE id=$2
      AND task_status='pending'
      RETURNING *
      `,
      [volunteerId, id]
    );

    if (!update.rows.length) throw withStatus("Task already taken", 409);

    await client.query("COMMIT");

    const updatedReservation = update.rows[0];

    // 🔥 Schedule pickup timeout (ONLY ONCE)
    if (updatedReservation.pickup_type === "ngo") {
      await pickupQueue.add(
        "pickup-timeout",
        { reservationId: updatedReservation.id },
        {
          delay: 15 * 60 * 1000, // 15 minutes
          jobId: `pickup-${updatedReservation.id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 3600, count: 1000 }
        }
      );

      logger.info("Pickup timeout scheduled", { reservationId: updatedReservation.id });
    }

    await Promise.all([
      publishReservationUpdated(updatedReservation.id, {
        action: "volunteer_assigned",
      }),
      publishVolunteerUpdated(updatedReservation.id, {
        action: "pickup_started",
      }),
      publishTaskAvailabilityUpdated(updatedReservation.id, {
        action: "task_claimed",
      }),
      updatedReservation.pickup_type === "ngo"
        ? notificationQueue
            .add("notify-user", {
              userId: updatedReservation.user_id,
              type: "volunteer_started",
              title: "Volunteer Started Pickup",
              message: "Volunteer has started the pickup task.",
              data: {
                reservation_id: updatedReservation.id,
                listing_id: updatedReservation.listing_id,
                volunteer_id: volunteerId,
              },
            })
            .catch((err) => {
              logger.warn("NGO volunteer start notification failed", {
                err,
                reservationId: updatedReservation.id,
                ngoUserId: updatedReservation.user_id,
                volunteerId,
              });
            })
        : Promise.resolve(),
    ]);

    delete updatedReservation.receive_code;

    res.json({
      message: "Task started",
      reservation: updatedReservation,
    });

  } catch (err) {
    await client.query("ROLLBACK");

    res.status(err.statusCode || 400).json({
      error: err.message,
    });
  } finally {
    client.release();
  }
};

exports.getTasks = async (req, res) => {
  if (req.user.role !== "volunteer")
    return res.status(403).json({ error: "Only volunteers allowed" });

  const { lat, lng, radius = 5 } = req.query;

  if (!isProvided(lat) || !isProvided(lng)) {
    return res.status(400).json({ error: "Location required" });
  }

  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  const radiusMeters = toNumber(radius);

  if (!isNumberInRange(radiusMeters, 0.1, 100)) {
    return res.status(400).json({ error: "Radius must be between 0.1 and 100 km" });
  }

  const client = await pool.connect();
  try {
    // 1️⃣ Get volunteer NGO
    const volunteer = await pool.query(
      `
      SELECT ngo_id
      FROM volunteers
      WHERE user_id=$1
      AND status='active'
      LIMIT 1
      `,
      [req.user.id],
    );

    if (!volunteer.rows.length)
      return res.status(403).json({ error: "Not part of any active NGO" });

    const ngoId = volunteer.rows[0].ngo_id;

    const ngoResult = await client.query(
      `SELECT id,user_id,banned_until FROM ngos WHERE id=$1`,
      [ngoId],
    );

    if (!ngoResult.rows.length) throw withStatus("NGO profile not found", 404);

    const ngo = ngoResult.rows[0];

    // 2️⃣ Fetch nearby tasks
    const tasks = await pool.query(
      `
      SELECT 
        r.id AS reservation_id,
        r.quantity_reserved,
        r.pickup_type,
        r.status,
        r.task_status,
        f.id AS listing_id,
        f.title,
        f.latitude,
        f.longitude,
        f.latitude AS restaurant_latitude,
        f.longitude AS restaurant_longitude,
        f.pickup_start_time,
        f.pickup_end_time,
        u.id AS provider_id,
        u.name AS provider_name,
        u.phone AS provider_phone,
        n.organization_name AS ngo_name,
        n.latitude AS ngo_latitude,
        n.longitude AS ngo_longitude,
        ST_Distance(
            f.location,
            ST_SetSRID(ST_MakePoint($1,$2),4326)::geography
        ) AS distance
      FROM reservations r
      JOIN food_listings f ON r.listing_id = f.id
      JOIN users u ON u.id = f.provider_id
      JOIN ngos n ON n.user_id = r.user_id
      WHERE r.user_id = $3
      AND r.pickup_type = 'ngo'
      AND r.status = 'reserved'
      AND r.task_status IN ('pending','assigned')
      AND ST_DWithin(
          f.location,
          ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
          $4*1000
      )
      ORDER BY distance
      `,
      [toNumber(lng), toNumber(lat), ngo.user_id, radiusMeters],
    );
    res.json(tasks.rows);
  } catch (err) {
    logger.error("Failed to fetch volunteer tasks", { err, userId: req.user?.id });
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : "Failed to fetch tasks" });
  }
};

/*
====================================================
VOLUNTEER COMPLETE TASK
====================================================
*/

exports.completeTask = async (req, res) => {
  if (req.user.role !== "volunteer")
    return res.status(403).json({ error: "Only volunteers allowed" });

  const { id } = req.params;
  const { receive_code } = req.body;
  const volunteerId = req.user.id;

  if (!isValidId(id)) {
    return res.status(400).json({ error: "Task id is required" });
  }

  if (!isProvided(receive_code)) {
    return res.status(400).json({ error: "Receive code is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const reservationResult = await client.query(
      `
      SELECT *
      FROM reservations
      WHERE id=$1
      FOR UPDATE
      `,
      [id],
    );

    if (!reservationResult.rows.length)
      throw withStatus("Reservation not found", 404);

    const reservation = reservationResult.rows[0];

    if (reservation.assigned_volunteer_id !== volunteerId)
      throw withStatus("Not assigned to you", 403);

    if (reservation.status !== "reserved")
      throw withStatus("Reservation already completed", 409);

    if (reservation.task_status !== "picked_from_provider")
      throw withStatus("Provider has not confirmed pickup", 400);

    if (reservation.receive_code !== receive_code)
      throw withStatus("Invalid receive code", 400);

    await client.query(
      `
      UPDATE reservations
      SET task_status='delivered',
          status='picked_up',
          completed_at=NOW()
      WHERE id=$1
      `,
      [id],
    );

    /*
    Update volunteer stats
    */

    await client.query(
      `
      INSERT INTO volunteer_stats (volunteer_id)
      VALUES ($1)
      ON CONFLICT (volunteer_id) DO NOTHING
      `,
      [volunteerId],
    );

    const assignedAt = new Date(reservation.assigned_at).getTime();
    const completedAt = Date.now();

    const completionTimeSec = Math.floor(
      (completedAt - assignedAt) / 1000
    );

    const stats = await client.query(
      `
      SELECT total_completed, avg_completion_time
      FROM volunteer_stats
      WHERE volunteer_id=$1
      FOR UPDATE
      `,
      [volunteerId]
    );

    let newAvg = completionTimeSec;

    if (stats.rows.length) {
      const { total_completed, avg_completion_time } = stats.rows[0];

      if (total_completed > 0) {
        newAvg = Math.floor(
          (avg_completion_time * total_completed + completionTimeSec) /
            (total_completed + 1)
        );
      }
    }

    // upsert
    await client.query(
      `
      INSERT INTO volunteer_stats (volunteer_id, total_completed, avg_completion_time)
      VALUES ($1, 1, $2)
      ON CONFLICT (volunteer_id)
      DO UPDATE SET
        total_completed = volunteer_stats.total_completed + 1,
        avg_completion_time = $2
      `,
      [volunteerId, newAvg]
    );

    await client.query("COMMIT");

    // 🔥 cancel delivery timeout
    await deliveryQueue.remove(`delivery-${reservation.id}`);

    await Promise.all([
      publishReservationUpdated(reservation.id, { action: "delivered" }),
      publishVolunteerUpdated(reservation.id, { action: "delivery_completed" }),
      publishTaskAvailabilityUpdated(reservation.id, { action: "unavailable" }),
      reservation.pickup_type === "ngo"
        ? notificationQueue
            .add("notify-user", {
              userId: reservation.user_id,
              type: "delivery_completed",
              title: "Delivery Completed",
              message: "Food has been delivered successfully.",
              data: {
                reservation_id: reservation.id,
                listing_id: reservation.listing_id,
                volunteer_id: volunteerId,
              },
            })
            .catch((err) => {
              logger.warn("NGO delivery completion notification failed", {
                err,
                reservationId: reservation.id,
                ngoUserId: reservation.user_id,
                volunteerId,
              });
            })
        : Promise.resolve(),
    ]);

    res.json({
      message: "Delivery completed successfully",
    });
  } catch (err) {
    await client.query("ROLLBACK");

    res.status(err.statusCode || 400).json({
      error: err.message,
    });
  } finally {
    client.release();
  }
};
