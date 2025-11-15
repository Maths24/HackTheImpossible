import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";

import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import { RenderEngine } from "../engine/renderEngine";
import { createInitialWorldState } from "../engine/worldState";
import { createDronesLayerDescriptor } from "../engine/dronesLayer";
import type { WorldState, DroneEntity, LngLat } from "../engine/types";

const PATH_SPEED = 0.05;

// Home base near (your area)
const KYIV_BASE: LngLat = [36.3694, 47.5931];

type MapViewProps = {
  targetCenter: [number, number] | null;
};

export const MapView: React.FC<MapViewProps> = ({ targetCenter }) => {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderEngine | null>(null);
  const worldRef = useRef<WorldState>(createInitialWorldState());
  const [selectedDrone, setSelectedDrone] = useState<DroneEntity | null>(null);

  // Track if we've registered the drones layer yet
  const dronesLayerRegisteredRef = useRef(false);

  // Draw & path refs
  const drawRef = useRef<MapboxDraw | null>(null);
  const pathRef = useRef<LngLat[]>([]);
  const segmentLengthsRef = useRef<number[]>([]);
  const totalLengthRef = useRef<number>(0);

  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  // Für die Formation:
  const baseParamRef = useRef<number>(0);       // Leader-Position auf dem Pfad (0..1)
  const simTimeRef = useRef<number>(0);         // Simulationszeit in Sekunden
  const hasRemovedRef = useRef<boolean>(false); // Haben wir schon eine Drohne „gekilled“?

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
      center: KYIV_BASE,
      zoom: 11
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

      // Erste Polygon-Zeichnung: Drohnen-Layer registrieren
      const engine = engineRef.current;
      if (engine && !dronesLayerRegisteredRef.current) {
        engine.registerLayer(createDronesLayerDescriptor());
        dronesLayerRegisteredRef.current = true;
        engine.update({ zoom: map.getZoom() });
      }
    };

    map.on("draw.create", handleDrawChange);
    map.on("draw.update", handleDrawChange);
    map.on("draw.delete", handleDrawChange);

    map.on("load", () => {
      // RenderEngine initialisieren
      const engine = new RenderEngine(map, worldRef.current);
      engineRef.current = engine;

      // Home-Base Marker
      const baseEl = document.createElement("div");
      baseEl.className = "base-marker";

      new mapboxgl.Marker({ element: baseEl })
        .setLngLat(KYIV_BASE)
        .addTo(map);

      // Animationsloop
      const animate = (timestamp: number) => {
        if (lastTimeRef.current == null) {
          lastTimeRef.current = timestamp;
        }
        const dt = (timestamp - lastTimeRef.current) / 1000; // seconds
        lastTimeRef.current = timestamp;

        simTimeRef.current += dt;

        const engineLocal = engineRef.current;
        const total = totalLengthRef.current;

        if (engineLocal && dt > 0 && total > 0 && dronesLayerRegisteredRef.current) {
          let world = worldRef.current;

          // Demo: nach 8 Sekunden fällt Drohne an Position 3 aus
          if (!hasRemovedRef.current && simTimeRef.current > 8 && world.drones.length > 4) {
            const removedIndex = 3; // „3. Drohne fällt aus“
            const newDrones = world.drones.filter((_, idx) => idx !== removedIndex);
            world = { ...world, drones: newDrones };
            worldRef.current = world;
            hasRemovedRef.current = true;
          }

          const n = world.drones.length;
          if (n > 1) {
            // Leader bewegt sich entlang des Pfads
            baseParamRef.current = (baseParamRef.current + PATH_SPEED * dt) % 1;

            const updatedDrones: DroneEntity[] = world.drones.map((d, idx) => {
              // gleichmäßiger Abstand auf dem Pfad: f_i = (Leader + idx/n)
              const f = (baseParamRef.current + idx / n) % 1;
              const pos = pointAtFraction(f);
              if (!pos) return d;
              return {
                ...d,
                pathParam: f,
                position: pos
              };
            });

            const newWorld: WorldState = { ...world, drones: updatedDrones };
            worldRef.current = newWorld;
            engineLocal.setWorldState(newWorld);
            engineLocal.update({ zoom: map.getZoom() });
          }
        }

        animationFrameRef.current = requestAnimationFrame(animate);
      };

      animationFrameRef.current = requestAnimationFrame(animate);

      // Click handler für Drohnen
      map.on("click", "drones-layer", (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;

        const id = feature.properties.id as string | undefined;
        if (!id) return;

        const world = worldRef.current;
        const drone = world.drones.find((d) => d.id === id) || null;
        setSelectedDrone(drone);
      });

      // Klick auf leere Karte -> Auswahl löschen
      map.on("click", (e) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: ["drones-layer"]
        });
        if (!features.length) {
          setSelectedDrone(null);
        }
      });
    });

    // Engine bei Zoom-Änderung updaten
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

  // Fly to searched target from MainView
  useEffect(() => {
    if (!mapRef.current || !targetCenter) return;

    mapRef.current.flyTo({
      center: targetCenter,
      zoom: 11,
      essential: true
    });
  }, [targetCenter]);

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