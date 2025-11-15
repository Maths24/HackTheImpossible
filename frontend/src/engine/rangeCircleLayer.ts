// src/engine/rangeCircleLayer.ts
import type { FeatureCollection, Polygon, Feature } from "geojson";
import type { LayerDescriptor, WorldState } from "./types";
import * as turf from "@turf/turf";

export const createRangeCircleLayerDescriptor = (): LayerDescriptor => {
  const descriptor: LayerDescriptor = {
    id: "home-base-range",
    sourceId: "home-base-range-source",
    layerId: "home-base-range-layer",
    kind: "polygon",
    minZoom: 3,
    maxZoom: 22,
    visibleByDefault: true,
    dataSelector: (world: WorldState): FeatureCollection<Polygon> => {
      if (!world.homeBase) {
        return { type: "FeatureCollection", features: [] };
      }

      const center = world.homeBase.position;
      const radiusKm = world.homeBase.rangeKm ?? 10;

      const circle = turf.circle(center, radiusKm, {
        steps: 128,
        units: "kilometers"
      }) as Feature<Polygon>;

      return {
        type: "FeatureCollection",
        features: [circle]
      };
    },
    paint: {
      // fill + outline: fill via this layer, outline via another if you want,
      // but one layer is enough for now
      "fill-color": "#00ffc4",
      "fill-opacity": 0.1
    }
  };

  return descriptor;
};