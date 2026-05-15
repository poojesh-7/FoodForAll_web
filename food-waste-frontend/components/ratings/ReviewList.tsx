import type { ListingRating } from "@backend/contracts/api-contracts";
import { MessageSquare, Star } from "lucide-react";

type ReviewListProps = {
  ratings: ListingRating[];
  emptyMessage?: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

export default function ReviewList({
  ratings,
  emptyMessage = "No reviews yet.",
}: ReviewListProps) {
  if (ratings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-500">
          <MessageSquare className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="mt-3 text-sm font-medium text-zinc-950">{emptyMessage}</p>
        <p className="mt-1 text-sm text-zinc-500">
          Completed pickup reviews will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {ratings.map((rating, index) => (
        <article
          key={String(rating.id ?? `${String(rating.name ?? "review")}-${rating.created_at}-${index}`)}
          className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-zinc-950">
                {rating.name || "Food saver"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {formatDate(rating.created_at)}
              </p>
            </div>
            <p className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-sm font-semibold text-amber-700">
              <Star className="h-3.5 w-3.5" aria-hidden="true" />
              {Number(rating.rating).toFixed(1)}
            </p>
          </div>
          {rating.review && (
            <p className="mt-4 text-sm leading-6 text-zinc-700">{rating.review}</p>
          )}
        </article>
      ))}
    </div>
  );
}
