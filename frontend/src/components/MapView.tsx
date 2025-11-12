import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { RenderEngine } from "../engine/renderEngine";
import { createInitialWorldState } from "../engine/worldState";
import { createDronesLayerDescriptor } from "../engine/dronesLayer";
import type { WorldState, DroneEntity } from "../engine/types";

export const MapView = () => {
    const mapRef = useRef<mapboxgl.Map | null> (null);
    const mapContainerRef = useRef<HTMLDivElement | null> (null);
    const engineRef = useRef<RenderEngine | null> (null);
    const worldRef = useRef<WorldState>(createInitialWorldState());
    const [selectedDrone, setSelectedDrone] = useState<DroneEntity | null> (null);

    useEffect(() => {
        mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string;
        if (!mapContainerRef.current || mapRef.current) return;

        const map = new mapboxgl.Map({
            container: mapContainerRef.current,
            style: "mapbox://styles/mapbox/streets-v12",
            center: [-74.0, 40.7],
            zoom: 9
        });

        map.addControl(new mapboxgl.NavigationControl(), "top-right");

        map.on("load", () => {
            // Initialize render engine with initial world stte
            const engine = new RenderEngine(map, worldRef.current);
            engineRef.current = engine;

            // Register drones layer
            engine.registerLayer(createDronesLayerDescriptor());

            // Initial render 
            engine.update({ zoom: map.getZoom() });

            // Click handler for drones
            map.on("click", "drones-layer", (e) => {
                const feature = e.features?.[0];
                if (!feature || !feature.properties) return;

                const id = feature.properties.id as string | undefined;
                if (!id) return;

                // Look up the full drone entity from world state
                const world = worldRef.current;
                const drone = world.drones.find((d) => d.id === id) || null;

                setSelectedDrone(drone);
            });

            // Clicking empty map clears selection
            map.on("click", (e) => {
                const features = map.queryRenderedFeatures(e.point, { layers: ["drones-layer"] });
                if (!features.length) {
                    setSelectedDrone(null);
                }
            });
        });

        // Update engine on zoom changes
        map.on("zoom", () => {
            const engine = engineRef.current;
            if (!engine) return;
            engine.update({ zoom: map.getZoom() });
        });

        mapRef.current = map;

        return () => {
            map.off("click", "drones-layer", () => {});
            map.off("click", () => {});
            map.remove();
            mapRef.current = null;
            engineRef.current = null
        };
    }, []);

    return (
        <>
            <div id="map-container" ref={mapContainerRef} />

            {selectedDrone && (
                <div className="drone-panel">
                    <h3>Drone: {selectedDrone.id}</h3>
                    <p>Side: {selectedDrone.side}</p>
                    <p>
                        Position: {selectedDrone.position[0].toFixed(4)}, {" "} {selectedDrone.position[0].toFixed(4)}
                    </p>
                    <button onClick={() => setSelectedDrone(null)}>Close</button>
                </div>
            )}
        </> 
    );
}