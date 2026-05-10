import { ratingService } from "@/services/rating.service";
import type { ProviderRatingSummary } from "@backend/contracts/api-contracts";

type ProviderReputationProps = {
  summary: ProviderRatingSummary | null;
};

export default function ProviderReputation({ summary }: ProviderReputationProps) {
  const average = ratingService.toRatingNumber(summary?.average_rating);
  const total = ratingService.toRatingNumber(summary?.total_reviews);

  return (
    <section className="grid gap-3 sm:grid-cols-2">
      <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-zinc-600">Average Rating</p>
        <p className="mt-2 text-2xl font-semibold text-zinc-950">
          {average.toFixed(1)} / 5
        </p>
        <p className="mt-1 text-sm text-zinc-500">Provider reputation score</p>
      </article>
      <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-zinc-600">Total Reviews</p>
        <p className="mt-2 text-2xl font-semibold text-zinc-950">{total}</p>
        <p className="mt-1 text-sm text-zinc-500">Reservation review count</p>
      </article>
    </section>
  );
}
