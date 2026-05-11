declare module "leaflet" {
  export type LatLngExpression = [number, number];
  export type LatLngBoundsExpression = LatLngExpression[];
  export type FitBoundsOptions = Record<string, unknown>;
  export interface MapOptions {
    center?: LatLngExpression;
    zoom?: number;
    scrollWheelZoom?: boolean;
    dragging?: boolean;
    doubleClickZoom?: boolean;
    zoomControl?: boolean;
    attributionControl?: boolean;
  }
  export class Map {
    fitBounds(
      bounds: LatLngBoundsExpression,
      options?: FitBoundsOptions
    ): this;
  }
  const L: {
    Icon: {
      Default: {
        mergeOptions(options: {
          iconRetinaUrl?: string;
          iconUrl?: string;
          shadowUrl?: string;
        }): void;
      };
    };
    latLngBounds(points: LatLngExpression[]): LatLngBoundsExpression;
  };
  export default L;
}
