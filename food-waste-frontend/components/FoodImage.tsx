/* eslint-disable @next/next/no-img-element */
import { ImageIcon } from "lucide-react";
import { getPrimaryImageUrl } from "@/lib/food";
import type { ListingImageRow } from "@shared/contracts/api-contracts";

type FoodImageProps = {
  source?: {
    primary_image_url?: string | null;
    images?: ListingImageRow[] | null;
    title?: string | null;
  } | null;
  className?: string;
  imageClassName?: string;
};

export default function FoodImage({
  source,
  className = "h-44",
  imageClassName = "",
}: FoodImageProps) {
  const imageUrl = getPrimaryImageUrl(source ?? undefined);
  const title = String(source?.title ?? "Food listing");

  return (
    <div
      className={`relative overflow-hidden bg-zinc-100 ${className}`}
      aria-label={imageUrl ? undefined : "No listing image available"}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={title}
          className={`h-full w-full object-cover ${imageClassName}`}
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 border-b border-zinc-200 bg-zinc-100 text-zinc-500">
          <ImageIcon className="h-8 w-8" aria-hidden="true" />
          <span className="text-xs font-medium uppercase tracking-wide">
            No image
          </span>
        </div>
      )}
    </div>
  );
}
