const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");

const { notifyUser } = require("../shared/services/notification.service");

new Worker(
  "notification-queue",
  async (job) => {
    const { userId, type, title, message, data } = job.data;

    await notifyUser(userId, type, title, message, data);
  },
  {
    connection,
    attempts: 3,
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 1800, count: 500 }
  }
);