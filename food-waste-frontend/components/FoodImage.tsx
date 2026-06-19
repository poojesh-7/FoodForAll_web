"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  X,
} from "lucide-react";
import { getPrimaryImageUrl, sortListingImages } from "@/lib/food";
import type { ListingImageRow } from "@shared/contracts/api-contracts";

type FoodImageSource = {
  primary_image_url?: string | null;
  images?: ListingImageRow[] | null;
  title?: string | null;
};

type GalleryImage = {
  image_url: string;
  public_id?: string;
  display_order?: number | string;
};

type FoodImageProps = {
  source?: FoodImageSource | null;
  className?: string;
  imageClassName?: string;
  enableGallery?: boolean;
  showViewGalleryLink?: boolean;
  loading?: "eager" | "lazy";
};

type FoodImageCarouselProps = FoodImageProps;

function getGalleryImages(source?: FoodImageSource | null): GalleryImage[] {
  const images = sortListingImages(source?.images).filter((image) =>
    Boolean(image.image_url)
  );

  if (images.length > 0) return images;

  const primaryImageUrl = getPrimaryImageUrl(source ?? undefined);
  return primaryImageUrl ? [{ image_url: primaryImageUrl }] : [];
}

function normalizeIndex(index: number, count: number) {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

function PhotoBadge({ count }: { count: number }) {
  if (count <= 1) return null;

  return (
    <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-xs font-semibold text-white shadow-sm">
      📷 {count} Photos
    </span>
  );
}

function Placeholder() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 border-b border-zinc-200 bg-zinc-100 text-zinc-500">
      <ImageIcon className="h-8 w-8" aria-hidden="true" />
      <span className="text-xs font-medium uppercase tracking-wide">
        No Food Image Available
      </span>
    </div>
  );
}

function GalleryModal({
  images,
  title,
  initialIndex,
  onClose,
}: {
  images: GalleryImage[];
  title: string;
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const count = images.length;
  const current = images[normalizeIndex(index, count)];
  const previous = useCallback(
    () => setIndex((currentIndex) => normalizeIndex(currentIndex - 1, count)),
    [count]
  );
  const next = useCallback(
    () => setIndex((currentIndex) => normalizeIndex(currentIndex + 1, count)),
    [count]
  );

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Listing image gallery"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-0 top-0 z-10 inline-flex h-10 w-10 items-center justify-center rounded-md bg-white text-zinc-950 shadow-sm"
          aria-label="Close gallery"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="overflow-hidden rounded-lg bg-black">
          <div className="relative flex aspect-[4/3] max-h-[82vh] items-center justify-center">
            <img
              src={current.image_url}
              alt={`${title} image ${normalizeIndex(index, count) + 1}`}
              className="max-h-full max-w-full object-contain"
              loading="eager"
            />
            {count > 1 && (
              <>
                <button
                  type="button"
                  onClick={previous}
                  className="absolute left-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md bg-white/90 text-zinc-950 shadow-sm"
                  aria-label="Previous image"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="absolute right-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md bg-white/90 text-zinc-950 shadow-sm"
                  aria-label="Next image"
                >
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
          <div className="flex items-center justify-center border-t border-white/10 bg-black px-4 py-3 text-sm font-semibold text-white">
            {normalizeIndex(index, count) + 1} / {count}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FoodImage({
  source,
  className = "h-44",
  imageClassName = "",
  enableGallery = true,
  showViewGalleryLink = false,
  loading = "eager",
}: FoodImageProps) {
  const images = useMemo(() => getGalleryImages(source), [source]);
  const imageUrl = images[0]?.image_url || null;
  const title = String(source?.title ?? "Food listing");
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const canOpenGallery = enableGallery && images.length > 0;

  const openGallery = (event?: React.MouseEvent | React.KeyboardEvent) => {
    if (!canOpenGallery) return;
    event?.preventDefault();
    event?.stopPropagation();
    setModalIndex(0);
  };

  return (
    <>
      <div
        className={`relative overflow-hidden bg-zinc-100 ${className}`}
        aria-label={imageUrl ? undefined : "No listing image available"}
      >
        {imageUrl ? (
          <div
            role={canOpenGallery ? "button" : undefined}
            tabIndex={canOpenGallery ? 0 : undefined}
            className={`h-full w-full ${canOpenGallery ? "cursor-zoom-in" : ""}`}
            onClick={openGallery}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") openGallery(event);
            }}
          >
            <img
              src={imageUrl}
              alt={title}
              className={`h-full w-full object-cover ${imageClassName}`}
              loading={loading}
            />
          </div>
        ) : (
          <Placeholder />
        )}

        <PhotoBadge count={images.length} />

        {showViewGalleryLink && canOpenGallery && (
          <button
            type="button"
            onClick={openGallery}
            className="absolute bottom-3 right-3 rounded-md bg-white/95 px-3 py-1.5 text-xs font-semibold text-zinc-950 shadow-sm"
          >
            View Gallery
          </button>
        )}
      </div>

      {modalIndex !== null && (
        <GalleryModal
          images={images}
          title={title}
          initialIndex={modalIndex}
          onClose={() => setModalIndex(null)}
        />
      )}
    </>
  );
}

export function FoodImageCarousel({
  source,
  className = "h-72",
  imageClassName = "",
  enableGallery = true,
  loading = "eager",
}: FoodImageCarouselProps) {
  const images = useMemo(() => getGalleryImages(source), [source]);
  const [index, setIndex] = useState(0);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const count = images.length;
  const current = images[normalizeIndex(index, count)];
  const title = String(source?.title ?? "Food listing");
  const hasMultipleImages = count > 1;

  const previous = useCallback(
    () => setIndex((currentIndex) => normalizeIndex(currentIndex - 1, count)),
    [count]
  );
  const next = useCallback(
    () => setIndex((currentIndex) => normalizeIndex(currentIndex + 1, count)),
    [count]
  );
  const openGallery = () => {
    if (enableGallery && current) setModalIndex(normalizeIndex(index, count));
  };

  return (
    <>
      <div
        className={`relative overflow-hidden bg-zinc-100 ${className}`}
        onTouchStart={(event) => setTouchStartX(event.touches[0]?.clientX ?? null)}
        onTouchEnd={(event) => {
          if (touchStartX === null || !hasMultipleImages) return;
          const delta = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
          if (Math.abs(delta) > 40) {
            if (delta > 0) previous();
            else next();
          }
          setTouchStartX(null);
        }}
      >
        {current ? (
          <button
            type="button"
            onClick={openGallery}
            className={`block h-full w-full ${enableGallery ? "cursor-zoom-in" : ""}`}
            aria-label="Open image gallery"
          >
            <img
              src={current.image_url}
              alt={`${title} image ${normalizeIndex(index, count) + 1}`}
              className={`h-full w-full object-cover ${imageClassName}`}
              loading={loading}
            />
          </button>
        ) : (
          <Placeholder />
        )}

        <PhotoBadge count={count} />

        {hasMultipleImages && (
          <>
            <button
              type="button"
              onClick={previous}
              className="absolute left-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md bg-white/90 text-zinc-950 shadow-sm md:inline-flex"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={next}
              className="absolute right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md bg-white/90 text-zinc-950 shadow-sm md:inline-flex"
              aria-label="Next image"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-3 py-1 text-xs font-semibold text-white">
              Image {normalizeIndex(index, count) + 1} of {count}
            </div>
          </>
        )}
      </div>

      {modalIndex !== null && (
        <GalleryModal
          images={images}
          title={title}
          initialIndex={modalIndex}
          onClose={() => setModalIndex(null)}
        />
      )}
    </>
  );
}
