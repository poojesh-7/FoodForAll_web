"use client";

import type { FoodFormValues } from "@/lib/food";
import { quantityUnits } from "@/lib/quantityUnits";

type FoodListingFormProps = {
  values: FoodFormValues;
  mode: "create" | "edit";
  loading: boolean;
  canEditPricing?: boolean;
  pickupStartLabel?: string;
  onChange: (values: FoodFormValues) => void;
  onSubmit: () => void;
};

export default function FoodListingForm({
  values,
  mode,
  loading,
  canEditPricing = true,
  pickupStartLabel,
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

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          value={values.quantity}
          inputMode="numeric"
          placeholder="Quantity"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) => update({ quantity: event.target.value })}
        />
        <select
          value={values.quantity_unit}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) =>
            update({
              quantity_unit: event.target.value,
              custom_quantity_unit:
                event.target.value === "Other" ? values.custom_quantity_unit : "",
            })
          }
        >
          {quantityUnits.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </div>

      {values.quantity_unit === "Other" && (
        <input
          value={values.custom_quantity_unit}
          placeholder="Custom quantity unit"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
          onChange={(event) => update({ custom_quantity_unit: event.target.value })}
        />
      )}

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={values.is_free}
          disabled={!canEditPricing}
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
        disabled={values.is_free || !canEditPricing}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950 disabled:bg-zinc-100"
        onChange={(event) => update({ price: event.target.value })}
      />
      {!canEditPricing && (
        <p className="text-sm text-zinc-600">
          Price and free status are locked once reservations exist.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {mode === "create" ? (
          <label className="space-y-1 text-sm text-zinc-700">
            Pickup start
            <input
              value={values.pickup_start_time}
              type="datetime-local"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950"
              onChange={(event) => update({ pickup_start_time: event.target.value })}
            />
          </label>
        ) : (
          <div className="space-y-1 text-sm text-zinc-700">
            <p>Pickup start</p>
            <p className="min-h-10 rounded-md border border-zinc-200 bg-zinc-100 px-3 py-2 text-zinc-700">
              {pickupStartLabel || "Not set"}
            </p>
          </div>
        )}

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
