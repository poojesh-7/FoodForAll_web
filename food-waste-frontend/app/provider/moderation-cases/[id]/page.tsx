"use client";

/* eslint-disable @next/next/no-img-element */
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ImagePlus,
  MessageSquare,
  Send,
  ShieldAlert,
  X,
} from "lucide-react";
import { providerModerationService } from "@/services/providerModeration.service";
import { useRealtimeStore } from "@/store/realtimeStore";
import type {
  ModerationCaseDetail,
  ProviderCaseResponseAttachmentRow,
  ProviderReportAttachmentRow,
} from "@shared/contracts/api-contracts";

type SelectedImage = {
  id: string;
  file: File;
  previewUrl: string;
};

type PreviewImage = {
  url: string;
  alt: string;
};

type EvidenceAttachment =
  | ProviderReportAttachmentRow
  | ProviderCaseResponseAttachmentRow;

const TERMINAL_STATUSES = new Set(["VALIDATED", "DISMISSED"]);
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function displayLabel(value: unknown) {
  return displayValue(value).replace(/_/g, " ");
}

function formatDate(value: string | undefined | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatFileSize(value: unknown) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadge(status: unknown) {
  const value = String(status || "OPEN").toUpperCase();
  if (value === "VALIDATED") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "DISMISSED") return "border-zinc-200 bg-zinc-100 text-zinc-700";
  if (value === "ESCALATED") return "border-red-200 bg-red-50 text-red-700";
  if (value === "AWAITING_RESPONSE") return "border-amber-200 bg-amber-50 text-amber-800";
  if (value === "UNDER_REVIEW") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-zinc-200 bg-white text-zinc-700";
}

function eventTitle(eventType: string) {
  if (eventType === "CASE_OPENED") return "Case opened";
  if (eventType === "CASE_STATUS_CHANGED") return "Status changed";
  if (eventType === "CASE_PROVIDER_RESPONSE_SUBMITTED") {
    return "Provider response submitted";
  }
  return displayLabel(eventType);
}

function attachmentUrl(attachment: EvidenceAttachment) {
  return providerModerationService.getAssetUrl(attachment.file_url);
}

export default function ProviderModerationCaseDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const caseId = Array.isArray(params.id) ? params.id[0] : params.id;
  const moderationCaseEvent = useRealtimeStore(
    (state) => state.moderationCases[String(caseId)]
  );

  const [moderationCase, setModerationCase] =
    useState<ModerationCaseDetail | null>(null);
  const [responseText, setResponseText] = useState("");
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const selectedImagesRef = useRef<SelectedImage[]>([]);
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadCase = useCallback(
    async (showLoading = false, syncResponseText = true) => {
      try {
        if (showLoading) setLoading(true);
        setError("");
        const result = await providerModerationService.getProviderModerationCase(caseId);
        setModerationCase(result);
        if (syncResponseText) {
          setResponseText(result.provider_response?.response_text || "");
        }
      } catch (err) {
        setError(providerModerationService.getErrorMessage(err));
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [caseId]
  );

  useEffect(() => {
    queueMicrotask(() => {
      void loadCase(true);
    });
  }, [loadCase]);

  useEffect(() => {
    if (!moderationCaseEvent) return;
    queueMicrotask(() => {
      void loadCase(false, false);
    });
  }, [loadCase, moderationCaseEvent]);

  useEffect(() => {
    selectedImagesRef.current = selectedImages;
  }, [selectedImages]);

  useEffect(() => {
    return () => {
      selectedImagesRef.current.forEach((image) =>
        URL.revokeObjectURL(image.previewUrl)
      );
    };
  }, []);

  const report = moderationCase?.report || null;
  const reportAttachments = Array.isArray(report?.attachments)
    ? report.attachments
    : [];
  const providerResponse = moderationCase?.provider_response || null;
  const providerResponseAttachments = Array.isArray(providerResponse?.attachments)
    ? providerResponse.attachments
    : [];
  const terminal = TERMINAL_STATUSES.has(String(moderationCase?.status || ""));
  const remainingImageSlots =
    MAX_IMAGES - providerResponseAttachments.length - selectedImages.length;

  const addImages = (files: FileList | null) => {
    if (!files || terminal) return;

    const incoming = Array.from(files);
    if (incoming.length > remainingImageSlots) {
      setError(`A response can include up to ${MAX_IMAGES} images total.`);
      return;
    }

    const invalid = incoming.find((file) => !ACCEPTED_IMAGE_TYPES.has(file.type));
    if (invalid) {
      setError("Only JPG, PNG, or WEBP images are allowed.");
      return;
    }

    const oversized = incoming.find((file) => file.size > MAX_IMAGE_BYTES);
    if (oversized) {
      setError("Each image must be 5 MB or smaller.");
      return;
    }

    setError("");
    setSelectedImages((current) => [
      ...current,
      ...incoming.map((file, index) => ({
        id: `${file.name}-${file.lastModified}-${index}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  };

  const removeImage = (id: string) => {
    setSelectedImages((current) => {
      const image = current.find((item) => item.id === id);
      if (image) URL.revokeObjectURL(image.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  };

  const submitResponse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (terminal) return;

    const trimmed = responseText.trim();
    if (!trimmed) {
      setError("Response text is required.");
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      setSuccess("");
      const updatedCase = await providerModerationService.submitProviderCaseResponse(
        caseId,
        {
          response_text: trimmed,
          attachments: selectedImages.map((image) => image.file),
        }
      );
      selectedImages.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      setSelectedImages([]);
      setModerationCase(updatedCase);
      setResponseText(updatedCase.provider_response?.response_text || trimmed);
      setSuccess("Response submitted.");
    } catch (err) {
      setError(providerModerationService.getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const openAttachmentPreview = (attachment: EvidenceAttachment, alt: string) => {
    const url = attachmentUrl(attachment);
    if (!url) return;
    setPreviewImage({ url, alt });
  };

  return (
    <main className="min-h-screen bg-zinc-50 p-4">
      <div className="mx-auto max-w-7xl space-y-5">
        <Link
          href="/provider/moderation-cases"
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 transition hover:text-zinc-950"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Moderation cases
        </Link>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {success}
          </p>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
            Loading moderation case...
          </div>
        ) : !moderationCase ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-sm">
            Moderation case not found.
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
            <section className="space-y-5">
              <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase text-zinc-500">
                      {displayLabel(moderationCase.reason || report?.reason)}
                    </p>
                    <h1 className="mt-1 text-xl font-semibold text-zinc-950">
                      {displayValue(report?.listing_title || moderationCase.summary)}
                    </h1>
                    <p className="mt-1 text-sm text-zinc-600">
                      Case {displayValue(moderationCase.id)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusBadge(
                      moderationCase.status
                    )}`}
                  >
                    {displayLabel(moderationCase.status)}
                  </span>
                </div>

                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <dt className="text-xs font-medium uppercase text-zinc-500">
                      Opened
                    </dt>
                    <dd className="mt-1 font-semibold text-zinc-950">
                      {formatDate(moderationCase.created_at)}
                    </dd>
                  </div>
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <dt className="text-xs font-medium uppercase text-zinc-500">
                      Updated
                    </dt>
                    <dd className="mt-1 font-semibold text-zinc-950">
                      {formatDate(moderationCase.updated_at)}
                    </dd>
                  </div>
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <dt className="text-xs font-medium uppercase text-zinc-500">
                      Report Status
                    </dt>
                    <dd className="mt-1 font-semibold text-zinc-950">
                      {displayLabel(report?.status)}
                    </dd>
                  </div>
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <dt className="text-xs font-medium uppercase text-zinc-500">
                      Reservation
                    </dt>
                    <dd className="mt-1 font-semibold text-zinc-950">
                      {displayValue(report?.reservation_id)}
                    </dd>
                  </div>
                </dl>
              </article>

              <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Original Report
                </p>
                <h2 className="mt-1 text-base font-semibold text-zinc-950">
                  {displayLabel(report?.reason)}
                </h2>
                {report?.description && (
                  <p className="mt-4 whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-700">
                    {report.description}
                  </p>
                )}

                {reportAttachments.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase text-zinc-500">
                      Reporter Evidence
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {reportAttachments.map((attachment) => {
                        const url = attachmentUrl(attachment);
                        if (!url) return null;

                        return (
                          <button
                            key={String(attachment.id)}
                            type="button"
                            onClick={() =>
                              openAttachmentPreview(
                                attachment,
                                "Reporter evidence preview"
                              )
                            }
                            className="group overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 text-left transition hover:border-zinc-400"
                          >
                            <span className="block aspect-[4/3] overflow-hidden">
                              <img
                                src={url}
                                alt="Reporter evidence"
                                className="h-full w-full object-cover transition group-hover:scale-105"
                              />
                            </span>
                            <span className="block truncate px-2 py-1 text-xs text-zinc-500">
                              {formatFileSize(attachment.file_size_bytes) ||
                                displayValue(attachment.mime_type)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </article>

              <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase text-zinc-500">
                      Provider Response
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-zinc-950">
                      {providerResponse ? "Response on file" : "Submit response"}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      {providerResponse
                        ? `Updated ${formatDate(providerResponse.updated_at)}`
                        : "No response has been submitted for this case."}
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${
                      terminal
                        ? "border-zinc-200 bg-zinc-100 text-zinc-600"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {terminal ? "Read only" : "Editable"}
                  </span>
                </div>

                <form className="mt-4 space-y-4" onSubmit={submitResponse}>
                  <textarea
                    value={responseText}
                    onChange={(event) => setResponseText(event.target.value)}
                    disabled={terminal || submitting}
                    maxLength={3000}
                    className="min-h-36 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-100"
                  />

                  {providerResponseAttachments.length > 0 && (
                    <div>
                      <p className="text-xs font-medium uppercase text-zinc-500">
                        Provider Evidence
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {providerResponseAttachments.map((attachment) => {
                          const url = attachmentUrl(attachment);
                          if (!url) return null;

                          return (
                            <button
                              key={String(attachment.id)}
                              type="button"
                              onClick={() =>
                                openAttachmentPreview(
                                  attachment,
                                  "Provider evidence preview"
                                )
                              }
                              className="group overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 text-left transition hover:border-zinc-400"
                            >
                              <span className="block aspect-[4/3] overflow-hidden">
                                <img
                                  src={url}
                                  alt="Provider response evidence"
                                  className="h-full w-full object-cover transition group-hover:scale-105"
                                />
                              </span>
                              <span className="block truncate px-2 py-1 text-xs text-zinc-500">
                                {formatFileSize(attachment.file_size_bytes) ||
                                  displayValue(attachment.mime_type)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {selectedImages.length > 0 && (
                    <div>
                      <p className="text-xs font-medium uppercase text-zinc-500">
                        Selected Images
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {selectedImages.map((image) => (
                          <div
                            key={image.id}
                            className="relative overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
                          >
                            <img
                              src={image.previewUrl}
                              alt="Selected evidence"
                              className="aspect-[4/3] w-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => removeImage(image.id)}
                              className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-100"
                              aria-label="Remove selected image"
                            >
                              <X className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <p className="truncate px-2 py-1 text-xs text-zinc-500">
                              {image.file.name}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!terminal && (
                    <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <label
                        className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-950 transition hover:bg-zinc-100 ${
                          remainingImageSlots <= 0 || submitting
                            ? "pointer-events-none opacity-50"
                            : ""
                        }`}
                      >
                        <ImagePlus className="h-4 w-4" aria-hidden="true" />
                        Add image
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          className="sr-only"
                          disabled={remainingImageSlots <= 0 || submitting}
                          onChange={(event) => {
                            addImages(event.target.files);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={submitting}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" aria-hidden="true" />
                        {submitting ? "Submitting..." : "Submit"}
                      </button>
                    </div>
                  )}
                </form>
              </article>
            </section>

            <aside className="space-y-5">
              <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-zinc-950">Timeline</h2>
                <ol className="mt-4 space-y-3">
                  {moderationCase.events.map((event) => (
                    <li
                      key={String(event.id)}
                      className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-zinc-700">
                          {event.event_type === "CASE_PROVIDER_RESPONSE_SUBMITTED" ? (
                            <MessageSquare className="h-4 w-4" aria-hidden="true" />
                          ) : event.event_type === "CASE_STATUS_CHANGED" ? (
                            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <Clock3 className="h-4 w-4" aria-hidden="true" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-zinc-950">
                            {eventTitle(event.event_type)}
                          </p>
                          {event.from_status || event.to_status ? (
                            <p className="mt-1 text-xs text-zinc-600">
                              {displayLabel(event.from_status)} to{" "}
                              {displayLabel(event.to_status)}
                            </p>
                          ) : null}
                          {event.note && (
                            <p className="mt-2 text-sm text-zinc-700">
                              {event.note}
                            </p>
                          )}
                          {event.event_type === "CASE_PROVIDER_RESPONSE_SUBMITTED" && (
                            <p className="mt-2 inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600">
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              {Number(
                                event.metadata?.attachment_count || 0
                              )} image
                              {Number(event.metadata?.attachment_count || 0) === 1
                                ? ""
                                : "s"}
                            </p>
                          )}
                          <p className="mt-2 text-xs text-zinc-500">
                            {formatDate(event.created_at)} by{" "}
                            {displayValue(event.actor_name || event.actor_role)}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </aside>
          </div>
        )}
      </div>

      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-h-full w-full max-w-4xl overflow-hidden rounded-lg bg-white"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-100"
              aria-label="Close preview"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            <img
              src={previewImage.url}
              alt={previewImage.alt}
              className="max-h-[82vh] w-full object-contain"
            />
          </div>
        </div>
      )}
    </main>
  );
}
