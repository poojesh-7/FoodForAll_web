function classifyDeadLetter(workerName, job, err) {
  const queueName = String(workerName || "");
  const jobName = String(job?.name || "");
  const message = String(job?.failedReason || err?.message || "");

  if (queueName === "refund-queue") {
    return {
      category: "financial_refund",
      retrySafe: true,
      reconciliationPath: "refund-reconciliation-sweep",
      reason:
        message.includes("timeout") || message.includes("network")
          ? "gateway_uncertain"
          : "refund_execution_retry_exhausted",
    };
  }

  if (queueName === "payment-queue") {
    return {
      category: "financial_payment",
      retrySafe: true,
      reconciliationPath: "payment-reconciliation-sweep",
      reason:
        jobName === "payment-reconciliation-sweep"
          ? "payment_sweep_retry_exhausted"
          : "payment_timeout_retry_exhausted",
    };
  }

  if (
    queueName === "financial-reconciliation-queue" ||
    queueName === "financial-reconciliation-worker"
  ) {
    return {
      category: "financial_reconciliation",
      retrySafe: true,
      reconciliationPath: "financial-reconciliation-sweep",
      reason: "financial_artifact_repair_retry_exhausted",
    };
  }

  return {
    category: "operational",
    retrySafe: false,
    reconciliationPath: null,
    reason: "retry_exhausted",
  };
}

module.exports = {
  classifyDeadLetter,
};
