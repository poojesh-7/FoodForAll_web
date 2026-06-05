"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { reservationService } from "@/services/reservation.service";
import { sanitizeOptionalTextInput } from "@/lib/sanitize";
import type { DbId, ReportProviderRequest } from "@shared/contracts/api-contracts";

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

const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type SelectedAttachment = {
  file: File;
  id: string;
  previewUrl: string;
};

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
  const [attachments, setAttachments] = useState<SelectedAttachment[]>([]);
  const previewUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const previewUrls = previewUrlsRef.current;
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.clear();
    };
  }, []);

  const revokePreview = (previewUrl: string) => {
    URL.revokeObjectURL(previewUrl);
    previewUrlsRef.current.delete(previewUrl);
  };

  const clearAttachments = () => {
    setAttachments((current) => {
      current.forEach((attachment) => revokePreview(attachment.previewUrl));
      return [];
    });
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.id === id);
      if (removed) revokePreview(removed.previewUrl);
      return current.filter((attachment) => attachment.id !== id);
    });
  };

  const chooseAttachments = (files: FileList | null) => {
    if (!files || submitted || submitting) return;
    const selected = Array.from(files);

    if (attachments.length + selected.length > MAX_ATTACHMENTS) {
      setValidationError("A report can include up to 3 images.");
      return;
    }

    for (const file of selected) {
      if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
        setValidationError("Only JPG, PNG, or WEBP images are allowed.");
        return;
      }

      if (file.size > MAX_ATTACHMENT_BYTES) {
        setValidationError("Each image must be 5 MB or smaller.");
        return;
      }
    }

    const next = selected.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      return {
        file,
        previewUrl,
        id: `${file.name}-${file.lastModified}-${previewUrl}`,
      };
    });

    setValidationError("");
    setAttachments((current) => [...current, ...next]);
  };

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
        description: sanitizeOptionalTextInput(description, {
          maxLength: 1000,
          preserveNewlines: true,
        }),
        attachments: attachments.map((attachment) => attachment.file),
      });
      const message = "Provider report submitted for moderation.";
      setDescription("");
      clearAttachments();
      setSubmitted(true);
      setFeedback(message);
      onSuccess?.(message);
    } catch (err) {
      const message = reservationService.getErrorMessage(err);
      const isDuplicate = message
        .toLowerCase()
        .includes("already reported this provider");

      if (isDuplicate) {
        clearAttachments();
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
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50">
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          <span>Add Images</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={submitting || submitted || attachments.length >= MAX_ATTACHMENTS}
            className="sr-only"
            onChange={(event) => {
              chooseAttachments(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        {attachments.length > 0 && (
          <span className="text-xs font-medium text-zinc-500">
            {attachments.length}/{MAX_ATTACHMENTS} selected
          </span>
        )}
      </div>
      {attachments.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="relative aspect-[4/3] overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
            >
              <img
                src={attachment.previewUrl}
                alt={attachment.file.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                disabled={submitting || submitted}
                className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-100 disabled:opacity-50"
                aria-label={`Remove ${attachment.file.name}`}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      {validationError && (
        <p className="text-sm font-medium text-red-700">{validationError}</p>
      )}
      {feedback && (
        <p className="text-sm font-medium text-emerald-700">{feedback}</p>
      )}
    </div>
  );
}
