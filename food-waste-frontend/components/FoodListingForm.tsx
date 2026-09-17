"use client";

/* eslint-disable @next/next/no-img-element */

import type { FoodFormValues } from "@/lib/food";
import {
  getListingImageValidationError,
  maxListingImages,
} from "@/lib/food";
import {
  dietaryTagOptions,
  foodCategoryOptions,
  toggleDietaryTag,
} from "@/lib/listingDiscovery";
import { quantityUnits } from "@/lib/quantityUnits";

const ENABLE_FREE_LISTING = false;

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
    <div className="space-y-6 rounded-lg border border-border bg-surface p-5 shadow-subtle sm:p-6">
      <div className="border-b border-border pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">Food details</p>
        <p className="mt-1 text-sm text-text-secondary">Describe what is available so it can find a useful second chance.</p>
      </div>
      <input
        aria-label="Food title"
        value={values.title}
        placeholder="Food title"
        className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-text-primary outline-none transition hover:border-brand focus:border-brand"
        onChange={(event) => update({ title: event.target.value })}
      />

      <textarea
        aria-label="Food description"
        value={values.description}
        placeholder="Description"
        rows={4}
        className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-text-primary outline-none transition hover:border-brand focus:border-brand"
        onChange={(event) => update({ description: event.target.value })}
      />

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <label className="space-y-2 text-sm text-text-secondary">
          Category
          <select
            value={values.category}
            className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-text-primary outline-none transition hover:border-brand focus:border-brand"
            onChange={(event) => update({ category: event.target.value })}
          >
            <option value="">Select category</option>
            {foodCategoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-text-secondary">Dietary tags</legend>
          <div className="flex flex-wrap gap-2">
            {dietaryTagOptions.map((option) => {
              const checked = values.dietary_tags.includes(option.value);
              return (
                <label
                  key={option.value}
                  className={`inline-flex cursor-pointer items-center rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                    checked
                      ? "border-brand bg-brand-soft text-brand-hover"
                      : "border-border bg-surface text-text-secondary"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    className="sr-only"
                    onChange={() =>
                      update({
                        dietary_tags: toggleDietaryTag(
                          values.dietary_tags,
                          option.value
                        ),
                      })
                    }
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <section className="space-y-3 border-t border-border pt-5">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <p className="text-base font-semibold text-text-primary">Images</p>
            <p className="text-xs text-text-muted">
              {values.images.length} / {maxListingImages} images
              <span className="ml-1">
                Optional JPG, PNG, or WEBP.
              </span>
            </p>
          </div>
          <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md border border-border-strong bg-surface px-3 text-sm font-semibold text-text-primary transition hover:bg-surface-muted">
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
          <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border-strong bg-surface-muted text-sm text-text-muted">
            No images added
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {values.images.map((image, index) => (
              <div
                key={image.id}
                className="overflow-hidden rounded-md border border-border bg-surface"
              >
                <img
                  src={image.previewUrl}
                  alt={`Listing image ${index + 1}`}
                  className="h-36 w-full object-cover"
                />
                <div className="flex items-center justify-between gap-2 p-2">
                  <span className="truncate text-xs font-medium text-text-secondary">
                    {index === 0 ? "Primary image" : `Image ${index + 1}`}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveImage(index, -1)}
                      disabled={index === 0}
                      className="min-h-8 rounded border border-border px-2 py-1 text-xs font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Left
                    </button>
                    <button
                      type="button"
                      onClick={() => moveImage(index, 1)}
                      disabled={index === values.images.length - 1}
                      className="min-h-8 rounded border border-border px-2 py-1 text-xs font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Right
                    </button>
                    <button
                      type="button"
                      onClick={() => removeImage(image.id)}
                      className="min-h-8 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100"
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
          aria-label="Quantity"
          value={values.quantity}
          inputMode="numeric"
          placeholder="Quantity"
          className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-text-primary outline-none transition hover:border-brand focus:border-brand"
          onChange={(event) => update({ quantity: event.target.value })}
        />
        <select
          aria-label="Quantity unit"
          value={values.quantity_unit}
          className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-text-primary outline-none transition hover:border-brand focus:border-brand"
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
          aria-label="Custom quantity unit"
          value={values.custom_quantity_unit}
          placeholder="Custom quantity unit"
          className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-text-primary outline-none transition hover:border-brand focus:border-brand"
          onChange={(event) => update({ custom_quantity_unit: event.target.value })}
        />
      )}

      <section className="space-y-3 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-base font-semibold text-text-primary">Pricing</p>
          {ENABLE_FREE_LISTING && (
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={values.is_free}
                disabled={!canEditPricing}
                onChange={(event) =>
                  update({
                    is_free: event.target.checked,
                    price: event.target.checked ? "0" : values.price,
                    original_price: event.target.checked ? "" : values.original_price,
                  })
                }
              />
              Free food
            </label>
          )}
        </div>

        {!values.is_free && (
          <div className="space-y-3">
            <label className="block space-y-2 text-sm text-text-secondary">
              <span>Regular price</span>
              <input
                aria-label="Regular price"
                value={values.original_price}
                inputMode="decimal"
                placeholder="₹ 50.00"
                disabled={!canEditPricing}
                className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-text-primary outline-none transition hover:border-brand focus:border-brand disabled:bg-surface-muted"
                onChange={(event) => update({ original_price: event.target.value })}
              />
            </label>

            <label className="block space-y-2 text-sm text-text-secondary">
              <span>Rescue price</span>
              <input
                aria-label="Rescue price"
                value={values.price}
                inputMode="decimal"
                placeholder="₹ 20.00"
                disabled={!canEditPricing}
                className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-text-primary outline-none transition hover:border-brand focus:border-brand disabled:bg-surface-muted"
                onChange={(event) => update({ price: event.target.value })}
              />
            </label>

            <p className="text-xs text-text-muted">
              Users pay the rescue price. Savings are calculated from the regular price.
            </p>

            {/* {Number(values.original_price) > 0 && Number(values.price) > 0 && Number(values.original_price) > Number(values.price) && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                You save ₹{(Number(values.original_price) - Number(values.price)).toFixed(2)} · {Math.round(((Number(values.original_price) - Number(values.price)) / Number(values.original_price)) * 100)}% off
              </div>
            )} */}
          </div>
        )}

        {values.is_free && (
          <div className="border-l-2 border-brand bg-brand-soft px-3 py-2 text-sm text-brand-hover">
            Free food: rescue price is set to ₹0.
          </div>
        )}
      </section>

      {!canEditPricing && (
        <p className="text-sm text-text-secondary">
          Price and free status are locked once reservations exist.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {mode === "create" ? (
          <label className="space-y-2 text-sm text-text-secondary">
            Pickup start
            <input
              aria-label="Pickup start"
              value={values.pickup_start_time}
              type="datetime-local"
              className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-text-primary outline-none transition hover:border-brand focus:border-brand"
              onChange={(event) => update({ pickup_start_time: event.target.value })}
            />
          </label>
        ) : (
          <div className="space-y-2 text-sm text-text-secondary">
            <p>Pickup start</p>
            <p className="min-h-11 rounded-md border border-border bg-surface-muted px-3 py-2 text-text-secondary">
              {pickupStartLabel || "Not set"}
            </p>
          </div>
        )}

        <label className="space-y-2 text-sm text-text-secondary">
          Pickup end
          <input
            aria-label="Pickup end"
            value={values.pickup_end_time}
            type="datetime-local"
            className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-text-primary outline-none transition hover:border-brand focus:border-brand"
            onChange={(event) => update({ pickup_end_time: event.target.value })}
          />
        </label>
      </div>

      <button
        onClick={onSubmit}
        disabled={loading}
        className="min-h-12 w-full rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Saving..." : mode === "create" ? "Create Listing" : "Save Changes"}
      </button>
    </div>
  );
}
