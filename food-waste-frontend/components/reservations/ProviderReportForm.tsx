"use client";

import { useState } from "react";
import { reservationService } from "@/services/reservation.service";
import type { DbId, ReportProviderRequest } from "@backend/contracts/api-contracts";

const reportReasonOptions: {
  value: ReportProviderRequest["reason"];
  label: string;
}[] = [
  { value: "provider_unavailable", label: "Provider unavailable" },
  { value: "expired_food", label: "Expired food" },
  { value: "fake_listing", label: "Fake listing" },
  { value: "unsafe_food", label: "Unsafe food" },
  { value: "abusive_behavior", label: "Abusive behavior" },
  { value: "repeated_cancellations", label: "Repeated cancellations" },
  { value: "incorrect_listing", label: "Incorrect listing" },
];

type ProviderReportFormProps = {
  reservationId: DbId;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
};

export default function ProviderReportForm({
  reservationId,
  onError,
  onSuccess,
}: ProviderReportFormProps) {
  const [reason, setReason] =
    useState<ReportProviderRequest["reason"]>("provider_unavailable");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [validationError, setValidationError] = useState("");

  const submitReport = async () => {
    if (submitting || submitted) return;
    if (!reason) {
      setValidationError("Choose a report reason.");
      return;
    }

    try {
      setSubmitting(true);
      setValidationError("");
      setFeedback("");
      onError?.("");
      onSuccess?.("");
      await reservationService.reportProvider(reservationId, {
        reason,
        description: description.trim() || null,
      });
      const message = "Provider report submitted for moderation.";
      setDescription("");
      setSubmitted(true);
      setFeedback(message);
      onSuccess?.(message);
    } catch (err) {
      const message = reservationService.getErrorMessage(err);
      const isDuplicate = message
        .toLowerCase()
        .includes("already reported this provider");

      if (isDuplicate) {
        setSubmitted(true);
        setFeedback(message);
        onSuccess?.(message);
      } else {
        setValidationError(message);
        onError?.(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[220px_1fr_auto] sm:items-start">
        <select
          value={reason}
          onChange={(event) =>
            setReason(event.target.value as ReportProviderRequest["reason"])
          }
          disabled={submitting || submitted}
          className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-500"
        >
          {reportReasonOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={submitting || submitted}
          maxLength={1000}
          placeholder="Optional details"
          className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-500"
        />
        <button
          type="button"
          onClick={submitReport}
          disabled={submitting || submitted}
          className="min-h-10 rounded-md border border-red-200 px-4 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Submitting..." : submitted ? "Reported" : "Report"}
        </button>
      </div>
      {validationError && (
        <p className="text-sm font-medium text-red-700">{validationError}</p>
      )}
      {feedback && (
        <p className="text-sm font-medium text-emerald-700">{feedback}</p>
      )}
    </div>
  );
}
