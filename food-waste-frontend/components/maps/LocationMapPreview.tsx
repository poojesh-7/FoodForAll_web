"use client";

import dynamic from "next/dynamic";

type MapPoint = {
  label: string;
  latitude: number;
  longitude: number;
};

type LocationMapPreviewProps = {
  points: MapPoint[];
};

const LeafletMapPreview = dynamic(() => import("./LeafletMapPreview"), {
  ssr: false,
  loading: () => (
    <div className="h-32 rounded-md border border-zinc-200 bg-zinc-100" />
  ),
});

export default function LocationMapPreview({ points }: LocationMapPreviewProps) {
  if (points.length === 0) return null;

  return <LeafletMapPreview points={points} />;
}

export type { MapPoint, LocationMapPreviewProps };
