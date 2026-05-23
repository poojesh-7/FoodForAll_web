"use client";

import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, Popup, useMap } from "react-leaflet";
import type { LocationMapPreviewProps } from "@/components/maps/LocationMapPreview";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  iconUrl: "/leaflet/marker-icon.png",
  shadowUrl: "/leaflet/marker-shadow.png",
});

function FitPoints({ points }: LocationMapPreviewProps) {
  const map = useMap();

  useEffect(() => {
    if (points.length <= 1) return;

    const bounds = L.latLngBounds(
      points.map((point) => [point.latitude, point.longitude])
    );
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
  }, [map, points]);

  return null;
}

export default function LeafletMapPreview({ points }: LocationMapPreviewProps) {
  const center = [points[0].latitude, points[0].longitude] as [number, number];

  return (
    <div className="relative z-0 isolate h-28 overflow-hidden rounded-md border border-zinc-200 [&_.leaflet-bottom]:!z-0 [&_.leaflet-pane]:!z-0 [&_.leaflet-top]:!z-0">
      <MapContainer
        center={center}
        zoom={14}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        zoomControl={false}
        attributionControl={false}
        className="relative z-0 h-full w-full"
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitPoints points={points} />
        {points.map((point) => (
          <Marker
            key={`${point.label}-${point.latitude}-${point.longitude}`}
            position={[point.latitude, point.longitude]}
          >
            <Popup>{point.label}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
