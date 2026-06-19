"use client";

import type { ListingDiscoveryFilters } from "@/lib/listingDiscovery";
import {
  dietaryTagOptions,
  foodCategoryOptions,
  listingSortOptions,
  toggleDietaryTag,
} from "@/lib/listingDiscovery";

type ListingDiscoveryControlsProps = {
  filters: ListingDiscoveryFilters;
  includePrice?: boolean;
  onChange: (filters: ListingDiscoveryFilters) => void;
  onApply?: () => void;
};

export default function ListingDiscoveryControls({
  filters,
  includePrice = true,
  onChange,
  onApply,
}: ListingDiscoveryControlsProps) {
  const update = (patch: Partial<ListingDiscoveryFilters>) =>
    onChange({ ...filters, ...patch });

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
        <input
          value={filters.search}
          placeholder="Search title, provider, or category"
          className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) => update({ search: event.target.value })}
        />
        <select
          value={filters.category}
          className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) => update({ category: event.target.value })}
        >
          <option value="">All categories</option>
          {foodCategoryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={filters.sort}
          className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) =>
            update({
              sort: event.target.value as ListingDiscoveryFilters["sort"],
              pickupEndingSoon: event.target.value === "pickup_ending_soon",
            })
          }
        >
          {listingSortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="flex min-h-10 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm text-zinc-700">
          <span className="whitespace-nowrap font-medium">Distance</span>
          <input
            value={filters.distance}
            inputMode="decimal"
            placeholder="km"
            className="min-w-0 flex-1 bg-transparent text-zinc-950 outline-none"
            onChange={(event) => update({ distance: event.target.value })}
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase text-zinc-500">
            Dietary tags
          </p>
          <div className="flex flex-wrap gap-2">
            {dietaryTagOptions.map((option) => {
              const checked = filters.dietaryTags.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    update({
                      dietaryTags: toggleDietaryTag(
                        filters.dietaryTags,
                        option.value
                      ),
                    })
                  }
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                    checked
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-zinc-200 bg-white text-zinc-700"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 md:min-w-[360px]">
          <label className="flex min-h-10 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm text-zinc-700">
            <span className="whitespace-nowrap font-medium">Qty</span>
            <input
              value={filters.minQuantity}
              inputMode="numeric"
              placeholder="min"
              className="min-w-0 flex-1 bg-transparent text-zinc-950 outline-none"
              onChange={(event) => update({ minQuantity: event.target.value })}
            />
          </label>
          {includePrice && (
            <label className="flex min-h-10 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm text-zinc-700">
              <span className="whitespace-nowrap font-medium">Price</span>
              <input
                value={filters.maxPrice}
                inputMode="decimal"
                placeholder="max"
                className="min-w-0 flex-1 bg-transparent text-zinc-950 outline-none"
                onChange={(event) => update({ maxPrice: event.target.value })}
              />
            </label>
          )}
          <label className="flex min-h-10 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={filters.pickupEndingSoon}
              onChange={(event) =>
                update({
                  pickupEndingSoon: event.target.checked,
                  sort: event.target.checked
                    ? "pickup_ending_soon"
                    : filters.sort,
                })
              }
            />
            Ending soon
          </label>
        </div>
      </div>

      {onApply && (
        <button
          type="button"
          onClick={onApply}
          className="min-h-10 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white"
        >
          Apply Filters
        </button>
      )}
    </section>
  );
}
