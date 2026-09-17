"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
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
  variant?: "default" | "marketplace";
  onChange: (filters: ListingDiscoveryFilters) => void;
  onApply?: () => void;
};

export default function ListingDiscoveryControls({
  filters,
  includePrice = true,
  variant = "default",
  onChange,
  onApply,
}: ListingDiscoveryControlsProps) {
  const isMarketplace = variant === "marketplace";
  const [filtersOpen, setFiltersOpen] = useState(false);
  const controlClass = isMarketplace
    ? "min-h-11 rounded-md border border-border-strong bg-surface px-3 text-sm text-text-primary outline-none placeholder:text-text-muted transition hover:border-brand focus:border-brand"
    : "min-h-10 rounded-md border border-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition hover:border-brand focus:border-brand";
  const selectClass = isMarketplace
    ? "min-h-11 rounded-md border border-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition hover:border-brand focus:border-brand"
    : "min-h-10 rounded-md border border-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition hover:border-brand focus:border-brand";
  const labelClass = isMarketplace
    ? "flex min-h-11 items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-sm text-text-secondary transition hover:border-brand focus-within:border-brand"
    : "flex min-h-10 items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-sm text-text-secondary transition hover:border-brand focus-within:border-brand";
  const innerInputClass = isMarketplace
    ? "min-w-0 flex-1 bg-transparent text-text-primary outline-none"
    : "min-w-0 flex-1 bg-transparent text-text-primary outline-none";
  const update = (patch: Partial<ListingDiscoveryFilters>) =>
    onChange({ ...filters, ...patch });

  return (
    <section className={isMarketplace ? "space-y-5 border-y border-border bg-surface/70 px-5 py-6 sm:px-6 lg:px-8" : "space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"}>
      {isMarketplace && <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Find a listing</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Search by food, provider, or what you are craving.
          </p>
        </div>
        {onApply && (
          <button
            type="button"
            onClick={onApply}
            className="min-h-11 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-hover"
          >
            Apply filters
          </button>
        )}
      </div>}

      {isMarketplace && (
        <input
          value={filters.search}
          placeholder="Search title, provider, or category"
          aria-label="Search title, provider, or category"
          className={`${controlClass} w-full md:hidden`}
          onChange={(event) => update({ search: event.target.value })}
        />
      )}

      {isMarketplace && (
        <button
          type="button"
          className="inline-flex min-h-10 self-end items-center justify-between rounded-md border border-border-strong bg-surface px-3 text-sm font-semibold text-text-primary transition hover:border-brand hover:bg-brand-soft md:hidden"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((current) => !current)}
        >
          Filters
          <ChevronDown
            className={`h-4 w-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      )}

      <div className={`${isMarketplace && !filtersOpen ? "hidden md:block" : "block"}`}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
        <input
          value={filters.search}
          placeholder="Search title, provider, or category"
          aria-label="Search title, provider, or category"
          className={`${controlClass} ${isMarketplace ? "hidden md:block" : ""}`}
          onChange={(event) => update({ search: event.target.value })}
        />
        <select
          value={filters.category}
          className={selectClass}
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
          className={selectClass}
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
        <label className={labelClass}>
          <span className="whitespace-nowrap font-medium">Distance</span>
          <input
            value={filters.distance}
            inputMode="decimal"
            placeholder="km"
            className={innerInputClass}
            onChange={(event) => update({ distance: event.target.value })}
          />
        </label>
      </div>

      <div className="grid gap-3 mt-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="space-y-2">
          <p className={isMarketplace ? "text-xs font-semibold uppercase tracking-wide text-text-muted" : "text-xs font-medium uppercase text-zinc-500"}>
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
                  className={isMarketplace ? `min-h-10 rounded-md border px-3 py-1.5 text-xs font-semibold transition ${checked ? "border-brand bg-brand-soft text-brand-hover" : "border-border bg-surface text-text-secondary hover:border-border-strong hover:bg-surface-muted"}` : `rounded-md border px-2.5 py-1.5 text-xs font-medium ${checked ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-zinc-200 bg-white text-zinc-700"}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:min-w-[360px]">
          <label className={`${labelClass} min-w-0`}>
            <span className="whitespace-nowrap font-medium">Qty</span>
            <input
              value={filters.minQuantity}
              inputMode="numeric"
              placeholder="min"
              className={innerInputClass}
              onChange={(event) => update({ minQuantity: event.target.value })}
            />
          </label>
          {includePrice && (
            <label className={`${labelClass} min-w-0`}>
              <span className="whitespace-nowrap font-medium">Price</span>
              <input
                value={filters.maxPrice}
                inputMode="decimal"
                placeholder="max"
                className={innerInputClass}
                onChange={(event) => update({ maxPrice: event.target.value })}
              />
            </label>
          )}
          <label className={`${labelClass} col-span-2 min-w-0 sm:col-span-1`}>
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

      </div>

      {onApply && !isMarketplace && (
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
