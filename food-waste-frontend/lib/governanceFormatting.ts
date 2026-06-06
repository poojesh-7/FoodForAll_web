type GovernanceEvent = {
  event_type?: string | null;
  from_status?: unknown;
  to_status?: unknown;
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  UNDER_REVIEW: "Under Review",
  AWAITING_RESPONSE: "Awaiting Response",
  VALIDATED: "Validated",
  DISMISSED: "Dismissed",
  ESCALATED: "Escalated",
  SUBMITTED: "Submitted",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  PENDING: "Pending",
  COMPLETED: "Completed",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  FAILED: "Failed",
};

function normalized(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatGovernanceStatus(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  const key = normalized(value);
  return STATUS_LABELS[key] || titleCase(String(value));
}

export function formatGovernanceDate(value: string | undefined | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  // Centralized here so future timezone normalization has one governance entry point.
  return date.toLocaleString();
}

export function governanceStatusBadge(status: unknown) {
  const value = normalized(status);
  if (["VALIDATED", "ACCEPTED", "COMPLETED", "DELIVERED"].includes(value)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (["REJECTED", "ESCALATED", "FAILED"].includes(value)) {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (["AWAITING_RESPONSE", "PENDING"].includes(value)) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (["SUBMITTED", "UNDER_REVIEW"].includes(value)) {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  if (["DISMISSED", "WITHDRAWN", "CANCELLED", "EXPIRED"].includes(value)) {
    return "border-zinc-200 bg-zinc-100 text-zinc-700";
  }
  return "border-zinc-200 bg-white text-zinc-700";
}

function appealStatusPresentation(toStatus: unknown) {
  const to = normalized(toStatus);
  if (to === "UNDER_REVIEW") {
    return {
      title: "Appeal moved to review",
      description: "Appeal is now under administrative review.",
    };
  }
  if (to === "ACCEPTED") {
    return {
      title: "Appeal accepted",
      description: "Administrator accepted the appeal.",
    };
  }
  if (to === "REJECTED") {
    return {
      title: "Appeal rejected",
      description: "Administrator rejected the appeal.",
    };
  }
  if (to === "WITHDRAWN") {
    return {
      title: "Appeal withdrawn",
      description: "Provider withdrew the appeal.",
    };
  }

  return {
    title: "Appeal status updated",
    description: toStatus
      ? `Appeal moved to ${formatGovernanceStatus(toStatus)}.`
      : "Appeal status was updated.",
  };
}

function caseStatusPresentation(toStatus: unknown) {
  const to = normalized(toStatus);
  if (to === "UNDER_REVIEW") {
    return {
      title: "Case assigned for review",
      description: "Case is now under administrative review.",
    };
  }
  if (to === "AWAITING_RESPONSE") {
    return {
      title: "Provider response requested",
      description: "Provider has been asked to respond.",
    };
  }
  if (to === "VALIDATED") {
    return {
      title: "Report validated",
      description: "Moderation review completed and the report was validated.",
    };
  }
  if (to === "DISMISSED") {
    return {
      title: "Report dismissed",
      description: "Moderation review completed and the report was dismissed.",
    };
  }
  if (to === "ESCALATED") {
    return {
      title: "Case escalated",
      description: "Case was escalated for additional review.",
    };
  }

  return {
    title: "Status changed",
    description: toStatus
      ? `Case moved to ${formatGovernanceStatus(toStatus)}.`
      : "Case status was updated.",
  };
}

export function getGovernanceEventPresentation(event: GovernanceEvent) {
  const eventType = String(event.event_type || "");

  if (eventType === "CASE_OPENED") {
    return {
      title: "Case opened",
      description: "Moderation case opened from a provider report.",
    };
  }
  if (eventType === "CASE_STATUS_CHANGED") {
    return caseStatusPresentation(event.to_status);
  }
  if (eventType === "CASE_PROVIDER_RESPONSE_SUBMITTED") {
    return {
      title: "Provider response submitted",
      description: "Provider submitted a response for admin review.",
    };
  }
  if (eventType === "CASE_APPEAL_SUBMITTED" || eventType === "APPEAL_SUBMITTED") {
    return {
      title: "Appeal submitted",
      description: "Provider submitted an appeal for review.",
    };
  }
  if (eventType === "CASE_APPEAL_WITHDRAWN" || eventType === "APPEAL_WITHDRAWN") {
    return {
      title: "Appeal withdrawn",
      description: "Provider withdrew the appeal.",
    };
  }
  if (
    eventType === "CASE_APPEAL_STATUS_CHANGED" ||
    eventType === "APPEAL_STATUS_CHANGED"
  ) {
    return appealStatusPresentation(event.to_status);
  }

  return {
    title: formatGovernanceStatus(eventType),
    description: "",
  };
}
