import type { ListingRating } from "@backend/contracts/api-contracts";

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
      <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
        {emptyMessage}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-950">
              {rating.name || "Food saver"}
            </p>
            <p className="text-sm font-medium text-amber-700">
              {Number(rating.rating).toFixed(1)} / 5
            </p>
          </div>
          {rating.review && (
            <p className="mt-2 text-sm text-zinc-600">{rating.review}</p>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            {formatDate(rating.created_at)}
          </p>
        </article>
      ))}
    </div>
  );
}
