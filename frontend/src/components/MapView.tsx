// src/components/MapView.tsx
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";

import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import { RenderEngine } from "../engine/renderEngine";
import { createInitialWorldState } from "../engine/worldState";
import { createDronesLayerDescriptor } from "../engine/dronesLayer";
import type { WorldState, DroneEntity, LngLat } from "../engine/types";

// Initial camera over your demo area (Kyiv-ish)
const KYIV_BASE: LngLat = [36.3694, 47.5931];

type MapViewProps = {
  targetCenter: [number, number] | null;
};

// DTO types for the backend responses
interface DroneDTO {
  id: string;
  side: "friendly" | "enemy";
  path_param: number;
  battery: number;
  mode: "PATROL" | "RETURNING";
  position: { lng: number; lat: number };
  exploration?: number;   // <-- new
}

interface HomeBaseDTO {
  id: string;
  position: { lng: number; lat: number };
}

interface WorldStateDTO {
  drones: DroneDTO[];
  home_base: HomeBaseDTO;
}

export const MapView: React.FC<MapViewProps> = ({ targetCenter }) => {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderEngine | null>(null);
  const worldRef = useRef<WorldState>(createInitialWorldState());
  const [selectedDrone, setSelectedDrone] = useState<DroneEntity | null>(null);

  const drawRef = useRef<MapboxDraw | null>(null);
  const pollingRef = useRef<number | null>(null);

  // Helper to convert backend DTO → our internal WorldState
  const dtoToWorldState = (dto: WorldStateDTO): WorldState => {
  return {
    drones: dto.drones.map((d) => ({
      id: d.id,
      side: d.side,
      pathParam: d.path_param,
      battery: d.battery,
      mode: d.mode,
      position: [d.position.lng, d.position.lat] as LngLat,
      offset: 0,
      exploration: d.exploration ?? 0   // <-- default to 0 if backend doesn’t send it
    })),
    homeBase: {
      id: dto.home_base.id,
      position: [
        dto.home_base.position.lng,
        dto.home_base.position.lat
      ] as LngLat
    }
  };
};

  useEffect(() => {
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string;
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: KYIV_BASE,
      zoom: 11,
    });

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true,
      },
    });

    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
    map.addControl(draw, "bottom-left");
    drawRef.current = draw;

    // Home base marker (purely visual; backend also knows the base)
    const baseEl = document.createElement("div");
    baseEl.className = "base-marker";
    new mapboxgl.Marker({ element: baseEl }).setLngLat(KYIV_BASE).addTo(map);

    map.on("load", () => {
      const engine = new RenderEngine(map, worldRef.current);
      engineRef.current = engine;

      // We always have the drones layer; it will just be empty
      engine.registerLayer(createDronesLayerDescriptor());
      engine.update({ zoom: map.getZoom() });
    });

    const handleDrawChange = () => {
      const d = draw.getAll();
      if (!d.features.length) return;

      const feature = d.features[0];
      if (feature.geometry.type !== "Polygon") return;

      const coords = feature.geometry.coordinates[0] as [number, number][];
      if (!coords || coords.length < 4) return;

      // Drop duplicate last point from Draw and convert to DTO
      const path: LngLat[] = coords
        .slice(0, -1)
        .map((c) => [c[0], c[1]] as LngLat);

      const sendPolygon = async () => {
        try {
          const body = {
            polygon: path.map(([lng, lat]) => ({ lng, lat })),
            num_active: 10, // how many patrol drones you want
          };

          const res = await fetch("http://localhost:8000/api/patrol/area", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            console.error("Failed to set patrol area");
            return;
          }

          const dto: WorldStateDTO = await res.json();
          const newWorld = dtoToWorldState(dto);

          worldRef.current = newWorld;
          const engine = engineRef.current;
          if (engine) {
            engine.setWorldState(newWorld);
            engine.update({ zoom: map.getZoom() });
          }
        } catch (err) {
          console.error("Error sending patrol polygon", err);
        }
      };

      void sendPolygon();
    };

    map.on("draw.create", handleDrawChange);
    map.on("draw.update", handleDrawChange);
    map.on("draw.delete", handleDrawChange);

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

    // Clicking on empty map clears selection
    map.on("click", (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ["drones-layer"],
      });
      if (!features.length) {
        setSelectedDrone(null);
      }
    });

    // Keep render engine in sync with zoom
    map.on("zoom", () => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.update({ zoom: map.getZoom() });
    });

    mapRef.current = map;

    return () => {
      if (pollingRef.current != null) {
        window.clearInterval(pollingRef.current);
      }
      map.remove();
      mapRef.current = null;
      engineRef.current = null;
      drawRef.current = null;
    };
  }, []);

  // Poll backend world-state regularly
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/world-state");
        if (!res.ok) return;

        const dto: WorldStateDTO = await res.json();
        const newWorld = dtoToWorldState(dto);

        worldRef.current = newWorld;
        const engine = engineRef.current;
        const map = mapRef.current;
        if (engine && map) {
          engine.setWorldState(newWorld);
          engine.update({ zoom: map.getZoom() });
        }
      } catch (err) {
        console.error("poll /api/world-state failed", err);
      }
    };

    // start polling
    const id = window.setInterval(poll, 400); // ~2.5 Hz
    pollingRef.current = id;

    // one immediate poll so you see something fast
    void poll();

    return () => {
      window.clearInterval(id);
    };
  }, []);

  // Fly to searched location from MainView
  useEffect(() => {
    if (!mapRef.current || !targetCenter) return;

    mapRef.current.flyTo({
      center: targetCenter,
      zoom: 11,
      essential: true,
    });
  }, [targetCenter]);

  return (
    <>
      <div id="map-container" ref={mapContainerRef} />

      {selectedDrone && (
        <div className="drone-panel">
          <h3>Drone: {selectedDrone.id}</h3>
          <p>Side: {selectedDrone.side}</p>
          <p>Mode: {selectedDrone.mode}</p>
          <p>Battery: {(selectedDrone.battery * 100).toFixed(0)}%</p>
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