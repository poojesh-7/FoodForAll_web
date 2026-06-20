"use client";

import type React from "react";
import { useState } from "react";
import { sanitizeTextInput } from "@/lib/sanitize";

type RatingFormProps = {
  onSubmit: (rating: number, review: string) => Promise<void>;
  disabled?: boolean;
  title?: string;
  description?: string;
  framed?: boolean;
  initialRating?: number | string | null;
  initialReview?: string | null;
  submitLabel?: string;
};

export default function RatingForm({
  onSubmit,
  disabled,
  title = "Rate Pickup",
  description = "Share feedback for this completed reservation.",
  framed = true,
  initialRating,
  initialReview,
  submitLabel = "Submit Review",
}: RatingFormProps) {
  const [rating, setRating] = useState<number | null>(() => {
    const value = Number(initialRating);
    return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
  });
  const [review, setReview] = useState(String(initialReview ?? ""));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitRating = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (rating === null) {
      setError("Choose a rating from 1 to 5.");
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      await onSubmit(
        rating,
        sanitizeTextInput(review, { maxLength: 500, preserveNewlines: true })
      );
      if (initialRating === undefined && initialReview === undefined) {
        setReview("");
        setRating(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submitRating}
      className={
        framed
          ? "space-y-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
          : "space-y-3"
      }
    >
      <div>
        <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
        <p className="mt-1 text-sm text-zinc-600">{description}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRating(value)}
            disabled={disabled || submitting}
            className={`h-10 w-10 rounded-md border text-lg font-semibold leading-none disabled:opacity-50 ${
              rating !== null && rating >= value
                ? "border-amber-300 bg-amber-50 text-amber-700"
                : "border-zinc-300 bg-white text-zinc-500"
            }`}
            aria-label={`${value} star rating`}
            aria-pressed={rating === value}
          >
            ★
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}

      <textarea
        value={review}
        onChange={(event) => setReview(event.target.value)}
        disabled={disabled || submitting}
        rows={3}
        maxLength={500}
        placeholder="Optional review"
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950 disabled:opacity-50"
      />

      <button
        type="submit"
        disabled={disabled || submitting || rating === null}
        className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Submitting..." : submitLabel}
      </button>
    </form>
  );
}
