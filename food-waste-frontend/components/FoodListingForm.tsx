"use client";

import type { FoodFormValues } from "@/lib/food";

type FoodListingFormProps = {
  values: FoodFormValues;
  mode: "create" | "edit";
  loading: boolean;
  onChange: (values: FoodFormValues) => void;
  onSubmit: () => void;
};

export default function FoodListingForm({
  values,
  mode,
  loading,
  onChange,
  onSubmit,
}: FoodListingFormProps) {
  const update = (patch: Partial<FoodFormValues>) => onChange({ ...values, ...patch });

  return (
    <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <input
        value={values.title}
        placeholder="Food title"
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
        onChange={(event) => update({ title: event.target.value })}
      />

      <textarea
        value={values.description}
        placeholder="Description"
        rows={4}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
        onChange={(event) => update({ description: event.target.value })}
      />

      {mode === "create" && (
        <input
          value={values.quantity}
          inputMode="numeric"
          placeholder="Quantity"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) => update({ quantity: event.target.value })}
        />
      )}

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={values.is_free}
          disabled={mode === "edit"}
          onChange={(event) =>
            update({
              is_free: event.target.checked,
              price: event.target.checked ? "0" : values.price,
            })
          }
        />
        Free food
      </label>

      <input
        value={values.price}
        inputMode="decimal"
        placeholder="Price"
        disabled={values.is_free}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-100"
        onChange={(event) => update({ price: event.target.value })}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm text-zinc-700">
          Pickup start
          <input
            value={values.pickup_start_time}
            type="datetime-local"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
            onChange={(event) => update({ pickup_start_time: event.target.value })}
          />
        </label>

        <label className="space-y-1 text-sm text-zinc-700">
          Pickup end
          <input
            value={values.pickup_end_time}
            type="datetime-local"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
            onChange={(event) => update({ pickup_end_time: event.target.value })}
          />
        </label>
      </div>

      <button
        onClick={onSubmit}
        disabled={loading}
        className="w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Saving..." : mode === "create" ? "Create Listing" : "Save Changes"}
      </button>
    </div>
  );
}
