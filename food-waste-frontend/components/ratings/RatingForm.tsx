"use client";

import type React from "react";
import { useState } from "react";

type RatingFormProps = {
  onSubmit: (rating: number, review: string) => Promise<void>;
  disabled?: boolean;
};

export default function RatingForm({ onSubmit, disabled }: RatingFormProps) {
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitRating = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      setSubmitting(true);
      await onSubmit(rating, review.trim());
      setReview("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submitRating}
      className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
    >
      <div>
        <h2 className="text-base font-semibold text-zinc-950">Rate Pickup</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Share feedback for this completed self pickup.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRating(value)}
            disabled={disabled || submitting}
            className={`h-10 w-10 rounded-md border text-sm font-semibold disabled:opacity-50 ${
              rating >= value
                ? "border-amber-300 bg-amber-50 text-amber-700"
                : "border-zinc-300 bg-white text-zinc-500"
            }`}
            aria-label={`${value} star rating`}
          >
            {value}
          </button>
        ))}
      </div>

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
        disabled={disabled || submitting}
        className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit Rating"}
      </button>
    </form>
  );
}
