import { MessageSquare, Star } from "lucide-react";

type ReviewSummarySource = {
  averageRating?: number | string | null;
  totalReviews?: number | string | null;
  average_rating?: number | string | null;
  total_reviews?: number | string | null;
  foodQualityAverage?: number | string | null;
  pickupExperienceAverage?: number | string | null;
  packagingAverage?: number | string | null;
};

type ReviewSummaryProps = {
  summary?: ReviewSummarySource | null;
  variant?: "inline" | "panel";
  showDimensions?: boolean;
};

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function getReviewSummaryValues(summary?: ReviewSummarySource | null) {
  return {
    averageRating: toNumber(summary?.averageRating ?? summary?.average_rating),
    totalReviews: toNumber(summary?.totalReviews ?? summary?.total_reviews),
    foodQualityAverage: summary?.foodQualityAverage,
    pickupExperienceAverage: summary?.pickupExperienceAverage,
    packagingAverage: summary?.packagingAverage,
  };
}

export default function ReviewSummary({
  summary,
  variant = "inline",
  showDimensions = false,
}: ReviewSummaryProps) {
  const {
    averageRating,
    totalReviews,
    foodQualityAverage,
    pickupExperienceAverage,
    packagingAverage,
  } = getReviewSummaryValues(summary);

  if (variant === "panel") {
    const dimensions = [
      ["Food Quality", foodQualityAverage],
      ["Pickup Experience", pickupExperienceAverage],
      ["Packaging", packagingAverage],
    ].filter(([, value]) => value !== undefined && value !== null);

    return (
      <section className="grid grid-cols-2 gap-2 sm:gap-3">
        <article className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold leading-4 text-zinc-600 sm:text-sm sm:font-medium">Average Rating</p>
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700">
              <Star className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-zinc-950 sm:mt-3 sm:text-3xl">
            {averageRating.toFixed(1)}
            <span className="text-base font-medium text-zinc-500"> / 5</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500 sm:text-sm">Provider Rating</p>
        </article>
        <article className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold leading-4 text-zinc-600 sm:text-sm sm:font-medium">Total Reviews</p>
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-700">
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-zinc-950 sm:mt-3 sm:text-3xl">
            {totalReviews}
          </p>
          <p className="mt-1 text-xs text-zinc-500 sm:text-sm">Reservation review count</p>
        </article>
        {showDimensions &&
          dimensions.map(([label, value]) => (
            <article
              key={String(label)}
              className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:p-5"
            >
              <p className="text-xs font-semibold leading-4 text-zinc-600 sm:text-sm sm:font-medium">{label}</p>
              <p className="mt-2 text-xl font-semibold text-zinc-950 sm:mt-3 sm:text-2xl">
                {toNumber(value).toFixed(1)}
                <span className="text-sm font-medium text-zinc-500"> / 5</span>
              </p>
            </article>
          ))}
      </section>
    );
  }

  if (totalReviews <= 0) {
    return <p className="text-xs font-medium text-zinc-500">No reviews yet</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="inline-flex items-center gap-1 font-semibold text-zinc-950">
        <Star className="h-4 w-4 fill-amber-400 text-amber-500" aria-hidden="true" />
        {averageRating.toFixed(1)}
      </span>
      <span className="text-xs font-medium text-zinc-500">
        {totalReviews} {totalReviews === 1 ? "Review" : "Reviews"}
      </span>
    </div>
  );
}
