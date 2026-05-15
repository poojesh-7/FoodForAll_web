import { ratingService } from "@/services/rating.service";
import type { ProviderRatingSummary } from "@backend/contracts/api-contracts";
import { MessageSquare, Star } from "lucide-react";

type ProviderReputationProps = {
  summary: ProviderRatingSummary | null;
};

export default function ProviderReputation({ summary }: ProviderReputationProps) {
  const average = ratingService.toRatingNumber(summary?.average_rating);
  const total = ratingService.toRatingNumber(summary?.total_reviews);

  return (
    <section className="grid gap-3 sm:grid-cols-2">
      <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-zinc-600">Average Rating</p>
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700">
            <Star className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
        <p className="mt-3 text-3xl font-semibold text-zinc-950">
          {average.toFixed(1)}
          <span className="text-base font-medium text-zinc-500"> / 5</span>
        </p>
        <p className="mt-1 text-sm text-zinc-500">Restaurant reputation score</p>
      </article>
      <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-zinc-600">Total Reviews</p>
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-700">
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
        <p className="mt-3 text-3xl font-semibold text-zinc-950">{total}</p>
        <p className="mt-1 text-sm text-zinc-500">Reservation review count</p>
      </article>
    </section>
  );
}
