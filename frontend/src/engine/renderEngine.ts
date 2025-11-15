import mapboxgl, { type CircleLayerSpecification } from "mapbox-gl";
import type { FeatureCollection, Point, Polygon, LineString } from "geojson";
import type { LayerDescriptor, WorldState } from "./types";

export interface ViewContext {
    zoom: number;
    // later: mode, filters, viewport bounds
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
        this.updateLayer(descriptor, {zoom: this.map.getZoom() });
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
                    paint, 
                    minzoom: minZoom,
                    maxzoom: maxZoom
                };

                this.map.addLayer(layer);
            } else {
                // In the future handle "line", "polygon", ...
            }
            this.initializedLayers.add(layerId);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private updateLayer(descriptor: LayerDescriptor , _view: ViewContext) {
        const { sourceId, kind, dataSelector } = descriptor;

        const source = this.map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
        if (!source) return;

        if (kind === "point") {
            const fc: FeatureCollection<Point> = dataSelector(this.world);
            source.setData(fc);
        } else if (kind === "polygon") {
            const fc = dataSelector(this.world) as FeatureCollection<Polygon>;
            source.setData(fc);
        } else if (kind === "line") {
            const fc = dataSelector(this.world) as FeatureCollection<LineString>;
            source.setData(fc);
        }
    }
}