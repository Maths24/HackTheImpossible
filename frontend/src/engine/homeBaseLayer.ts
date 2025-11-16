// src/engine/homeBaseLayer.ts
import type { FeatureCollection, Point, Feature } from "geojson";
import type { LayerDescriptor, WorldState } from "./types";

export const createHomeBaseLayerDescriptor = (): LayerDescriptor => {
  const descriptor: LayerDescriptor = {
    id: "home-base",
    sourceId: "home-base-source",
    layerId: "home-base-layer",
    kind: "point",
    minZoom: 3,
    maxZoom: 22,
    visibleByDefault: true,
    dataSelector: (world: WorldState): FeatureCollection<Point> => {
      if (!world.homeBase) {
        return { type: "FeatureCollection", features: [] };
      }

      const feature: Feature<Point> = {
        type: "Feature",
        properties: {
          kind: "home-base"
        },
        geometry: {
          type: "Point",
          coordinates: world.homeBase.position
        }
      };

      return {
        type: "FeatureCollection",
        features: [feature]
      };
    },
    paint: {
      "circle-radius": 10,
      "circle-color": "#00ffc4",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-opacity": 0.9
    }
  };

  return descriptor;
};