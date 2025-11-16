// src/engine/renderEngine.ts
import mapboxgl, {
  type CircleLayerSpecification,
  type FillLayerSpecification
} from "mapbox-gl";
import type { FeatureCollection } from "geojson";
import type { LayerDescriptor, WorldState } from "./types";

export interface ViewContext {
  zoom: number;
  // später: mode, filters, viewport bounds
}

export class RenderEngine {
  private map: mapboxgl.Map;
  private world: WorldState;
  private layers: LayerDescriptor[] = [];
  private initializedSources = new Set<string>();
  private initializedLayers = new Set<string>();

  constructor(map: mapboxgl.Map, initialWorld: WorldState) {
    this.map = map;
    this.world = initialWorld;
  }

  // Allow world state to be updated from outside
  public setWorldState(world: WorldState) {
    this.world = world;
  }

  // Register a new layer
  public registerLayer(descriptor: LayerDescriptor) {
    this.layers.push(descriptor);
    this.ensureSourceAndLayer(descriptor);
    this.updateLayer(descriptor, { zoom: this.map.getZoom() });
  }

  // Called on each render tick
  public update(view: ViewContext) {
    for (const descriptor of this.layers) {
      this.updateLayer(descriptor, view);
    }
  }

  private ensureSourceAndLayer(descriptor: LayerDescriptor) {
    const { sourceId, layerId, kind, paint, minZoom, maxZoom } = descriptor;

    if (!this.initializedSources.has(sourceId)) {
      // For now all layers use GeoJSON source
      this.map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: []
        } as FeatureCollection
      });
      this.initializedSources.add(sourceId);
    }

    if (!this.initializedLayers.has(layerId)) {
      if (kind === "point") {
        const layer: CircleLayerSpecification = {
          id: layerId,
          type: "circle",
          source: sourceId,
          paint: paint as CircleLayerSpecification["paint"],
          minzoom: minZoom,
          maxzoom: maxZoom
        };
        this.map.addLayer(layer);
      } else if (kind === "polygon") {
        const layer: FillLayerSpecification = {
          id: layerId,
          type: "fill",
          source: sourceId,
          paint: paint as FillLayerSpecification["paint"],
          minzoom: minZoom,
          maxzoom: maxZoom
        };
        this.map.addLayer(layer);
      }
      this.initializedLayers.add(layerId);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private updateLayer(descriptor: LayerDescriptor, _view: ViewContext) {
    const { sourceId, dataSelector } = descriptor;

    const source = this.map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    const fc = dataSelector(this.world);
    source.setData(fc);
  }
}