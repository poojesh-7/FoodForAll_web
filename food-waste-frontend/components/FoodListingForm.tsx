"use client";

/* eslint-disable @next/next/no-img-element */

import type { FoodFormValues } from "@/lib/food";
import {
  getListingImageValidationError,
  maxListingImages,
} from "@/lib/food";
import { quantityUnits } from "@/lib/quantityUnits";

type FoodListingFormProps = {
  values: FoodFormValues;
  mode: "create" | "edit";
  loading: boolean;
  canEditPricing?: boolean;
  pickupStartLabel?: string;
  onImageError?: (message: string) => void;
  onChange: (values: FoodFormValues) => void;
  onSubmit: () => void;
};

export default function FoodListingForm({
  values,
  mode,
  loading,
  canEditPricing = true,
  pickupStartLabel,
  onImageError,
  onChange,
  onSubmit,
}: FoodListingFormProps) {
  const update = (patch: Partial<FoodFormValues>) => onChange({ ...values, ...patch });
  const updateImages = (images: FoodFormValues["images"]) => update({ images });

  const addImages = (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;

    const validationError = getListingImageValidationError(
      selected,
      values.images.length
    );
    if (validationError) {
      onImageError?.(validationError);
      return;
    }

    updateImages([
      ...values.images,
      ...selected.map((file) => ({
        id:
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${file.name}-${file.lastModified}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  };

  const removeImage = (id: string) => {
    const image = values.images.find((item) => item.id === id);
    if (image?.file) URL.revokeObjectURL(image.previewUrl);
    updateImages(values.images.filter((item) => item.id !== id));
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= values.images.length) return;
    const next = [...values.images];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateImages(next);
  };

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

      <section className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold text-zinc-950">Listing images</p>
            <p className="text-xs text-zinc-500">
              {values.images.length} / {maxListingImages} images
              <span className="ml-1">
                Optional JPG, PNG, or WEBP.
              </span>
            </p>
          </div>
          <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-950">
            Add image
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              onChange={(event) => {
                addImages(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        {values.images.length === 0 ? (
          <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
            No images added
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {values.images.map((image, index) => (
              <div
                key={image.id}
                className="overflow-hidden rounded-md border border-zinc-200 bg-white"
              >
                <img
                  src={image.previewUrl}
                  alt={`Listing image ${index + 1}`}
                  className="h-36 w-full object-cover"
                />
                <div className="flex items-center justify-between gap-2 p-2">
                  <span className="truncate text-xs font-medium text-zinc-600">
                    {index === 0 ? "Primary image" : `Image ${index + 1}`}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveImage(index, -1)}
                      disabled={index === 0}
                      className="rounded border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 disabled:opacity-40"
                    >
                      Left
                    </button>
                    <button
                      type="button"
                      onClick={() => moveImage(index, 1)}
                      disabled={index === values.images.length - 1}
                      className="rounded border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 disabled:opacity-40"
                    >
                      Right
                    </button>
                    <button
                      type="button"
                      onClick={() => removeImage(image.id)}
                      className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
