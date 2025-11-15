import type { FeatureCollection, Point, /*LineString, Polygon*/ } from "geojson";
import type { CircleLayerSpecification } from "mapbox-gl";

// Basic geometry types
export type GeometryKind = "point" | "line" | "polygon";

export type LngLat = [number, number];

// Minimal worlds state
export type DroneSide = "friendly" | "enemy";

export interface DroneEntity {
    id: string;
    position: LngLat;
    side: DroneSide;
    pathParam: number;
}

export interface WorldState {
  drones: DroneEntity[];
  homeBase: {
    position: LngLat;
    rangeKm: number;   // or rangeMeters
  };
}

// Generic layer description
export interface PointLayerDescriptor {
    id: string;
    sourceId: string; // Mapbox source id
    layerId: string; // Mapbox layer id
    kind: "point";
    minZoom?: number;
    maxZoom?: number;

    // Select geo features from world state 
    dataSelector: (world: WorldState) => FeatureCollection<Point>;

    // Mapbox circle-layer paint props
    paint: CircleLayerSpecification["paint"];

    // Whether this layer is visible in the current "mode"
    visibleByDefault?: boolean;
}

export type LayerDescriptor = PointLayerDescriptor;

