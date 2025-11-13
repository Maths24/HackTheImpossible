import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";

import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import { RenderEngine } from "../engine/renderEngine";
import { createInitialWorldState } from "../engine/worldState";
import { createDronesLayerDescriptor } from "../engine/dronesLayer";
import type { WorldState, DroneEntity, LngLat } from "../engine/types";

const PATH_SPEED = 0.01;

export const MapView = () => {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderEngine | null>(null);
  const worldRef = useRef<WorldState>(createInitialWorldState());
  const [selectedDrone, setSelectedDrone] = useState<DroneEntity | null>(null);

  // Draw & path refs
  const drawRef = useRef<MapboxDraw | null>(null);
  const pathRef = useRef<LngLat[]>([]);
  const segmentLengthsRef = useRef<number[]>([]);
  const totalLengthRef = useRef<number>(0);

  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  // Path helpers
  const precomputePath = (path: LngLat[]) => {
    const segLens: number[] = [];
    let total = 0;

    const n = path.length;
    for (let i = 0; i < n; i++) {
      const p0 = path[i];
      const p1 = path[(i + 1) % n];
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      segLens.push(len);
      total += len;
    }

    segmentLengthsRef.current = segLens;
    totalLengthRef.current = total;
  };

  const pointAtFraction = (f: number): LngLat | null => {
    const path = pathRef.current;
    const segLens = segmentLengthsRef.current;
    const total = totalLengthRef.current;

    if (!path.length || !segLens.length || total === 0) return null;

    let distance = (((f % 1) + 1) % 1) * total;
    const n = path.length;

    for (let i = 0; i < n; i++) {
      const segLen = segLens[i];
      if (distance <= segLen) {
        const t = segLen === 0 ? 0 : distance / segLen;
        const p0 = path[i];
        const p1 = path[(i + 1) % n];
        const lng = p0[0] + (p1[0] - p0[0]) * t;
        const lat = p0[1] + (p1[1] - p0[1]) * t;
        return [lng, lat];
      }
      distance -= segLen;
    }
    return path[n - 1];
  };

  useEffect(() => {
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string;
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-74.0, 40.7],
      zoom: 9
    });

    // Mapbox Draw
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true
      }
    });

    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
    map.addControl(draw, "bottom-left"); 
    drawRef.current = draw;

    const handleDrawChange = () => {
      const d = draw.getAll();
      if (!d.features.length) {
        pathRef.current = [];
        segmentLengthsRef.current = [];
        totalLengthRef.current = 0; 
        return;
      }

      const feature = d.features[0];
      if (feature.geometry.type !== "Polygon") return;
      const coords = feature.geometry.coordinates[0] as [number, number][];

      if (!coords || coords.length < 4) return;

      // Drop duplicate last point
      const path: LngLat[] = coords
        .slice(0, -1)
        .map((c) => [c[0], c[1]] as LngLat);

      pathRef.current = path;
      precomputePath(path);
    };

    map.on("draw.create", handleDrawChange);
    map.on("draw.update", handleDrawChange);
    map.on("draw.delete", handleDrawChange);

    map.on("load", () => {
      // Initialize render engine with initial world state
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

        const world = worldRef.current;
        const drone = world.drones.find((d) => d.id === id) || null;
        setSelectedDrone(drone);
      });

      // Clicking empty map clears selection
      map.on("click", (e) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: ["drones-layer"]
        });
        if (!features.length) {
          setSelectedDrone(null);
        }
      });

      // Animation
      const animate = (timestamp: number) => {
        if (lastTimeRef.current == null) {
          lastTimeRef.current = timestamp;
        }
        const dt = (timestamp - lastTimeRef.current) / 1000; // seconds
        lastTimeRef.current = timestamp;

        const engine = engineRef.current;
        const total = totalLengthRef.current;

        if (engine && dt > 0 && total > 0) {
          const world = worldRef.current;
          const speed = PATH_SPEED;

          const updatedDrones = world.drones.map((d) => {
            const nextParam = (d.pathParam + speed * dt) % 1;
            const pos = pointAtFraction(nextParam);
            if (!pos) return d;
            return {
              ...d,
              pathParam: nextParam,
              position: pos
            };
          });

          const newWorld: WorldState = { ...world, drones: updatedDrones };
          worldRef.current = newWorld;
          engine.setWorldState(newWorld);
          engine.update({ zoom: map.getZoom() });
        }

        animationFrameRef.current = requestAnimationFrame(animate);
      };

      animationFrameRef.current = requestAnimationFrame(animate);
    });

    // Update engine on zoom changes
    map.on("zoom", () => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.update({ zoom: map.getZoom() });
    });

    mapRef.current = map;

    return () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (drawRef.current && map) {
        map.removeControl(drawRef.current);
      }
      map.remove();
      mapRef.current = null;
      engineRef.current = null;
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
            Position: {selectedDrone.position[0].toFixed(4)},{" "}
            {selectedDrone.position[1].toFixed(4)}
          </p>
          <button onClick={() => setSelectedDrone(null)}>Close</button>
        </div>
      )}
    </>
  );
};