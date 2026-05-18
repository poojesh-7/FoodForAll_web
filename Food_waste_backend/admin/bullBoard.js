const { createBullBoard } = require("@bull-board/api");
const { ExpressAdapter } = require("@bull-board/express");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");

// import all queues
const expiryQueue = require("../queues/expiry.queue");
const pickupQueue = require("../queues/pickup.queue");
const deliveryQueue = require("../queues/delivery.queue");
const alertQueue = require("../queues/expiryAlert.queue");
const notificationQueue = require("../queues/notification.queue");
const paymentQueue = require("../queues/payment.queue");
const refundQueue = require("../queues/refund.queue");
const deadLetterQueue = require("../queues/deadLetter.queue");

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [
    new BullMQAdapter(expiryQueue),
    new BullMQAdapter(alertQueue),
    new BullMQAdapter(pickupQueue),
    new BullMQAdapter(deliveryQueue),
    new BullMQAdapter(notificationQueue),
    new BullMQAdapter(paymentQueue),
    new BullMQAdapter(refundQueue),
    new BullMQAdapter(deadLetterQueue),
  ],
  serverAdapter,
});

module.exports = serverAdapter;
