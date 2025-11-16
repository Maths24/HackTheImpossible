// src/engine/dronesLayer.ts
import type { FeatureCollection, Point } from "geojson";
import type { LayerDescriptor, WorldState } from "./types";

// Drones: one circle per drone, styled by side
export const createDronesLayerDescriptor = (): LayerDescriptor => {
  const descriptor: LayerDescriptor = {
    id: "drones",
    sourceId: "drones-source",
    layerId: "drones-layer",
    kind: "point",
    minZoom: 3,
    maxZoom: 22,
    visibleByDefault: true,
    dataSelector: (world: WorldState): FeatureCollection<Point> => {
      return {
        type: "FeatureCollection",
        features: world.drones.map((drone) => ({
          type: "Feature",
          properties: {
            id: drone.id,
            side: drone.side
          },
          geometry: {
            type: "Point",
            coordinates: drone.position
          }
        }))
      };
    },
    paint: {
      "circle-radius": 4,
      "circle-color": [
        "match",
        ["get", "side"],
        "friendly",
        "#FF5C00",
        "enemy",
        "#ff4b4b",
        /* default */ "#ffffff"
      ],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1
    }  // TS nicht zu pingelig sein lassen
  };
  return descriptor;
};