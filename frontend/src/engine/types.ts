// src/engine/types.ts
import type { FeatureCollection, Geometry } from "geojson";
import type {
  CircleLayerSpecification,
  FillLayerSpecification
} from "mapbox-gl";

export type LngLat = [number, number];

export type DroneSide = "friendly" | "enemy";

export type DroneMode = "PATROL" | "RETURNING"; // fürs Demo reichen 2 Modi

export interface DroneEntity {
  id: string;
  position: LngLat;
  side: DroneSide;

  pathParam: number;
  battery: number;
  mode: DroneMode;

  offset: number;
  exploration: number;   // <-- required field
}

export interface HomeBase {
  id: string;
  position: LngLat;
  rangeKm?: number;   // <-- make it optional
}

export interface WorldState {
  drones: DroneEntity[];
  homeBase: HomeBase;
}

// ===== Rendering-Layer-Typen =====

export type LayerKind = "point" | "polygon";
export type LayerPaint =
  | NonNullable<CircleLayerSpecification["paint"]>
  | NonNullable<FillLayerSpecification["paint"]>;

export interface LayerDescriptor {
  id: string;
  sourceId: string;
  layerId: string;
  kind: LayerKind;
  minZoom?: number;
  maxZoom?: number;
  visibleByDefault?: boolean;

  // welche Daten gerendert werden
  dataSelector: (world: WorldState) => FeatureCollection<Geometry>;

  // Styling – je nach kind wird daraus ein Circle- oder Fill-Layer gebaut
  paint: LayerPaint;

}