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
const KYIV_BASE: LngLat = [36.255577, 47.464746];

// Static image for the “what the drone sees” view
const DRONE_VIEW_IMAGE = "/drone-view-demo.png";

type MapViewProps = {
  targetCenter: [number, number] | null;
};

// ---------- DTO types that mirror backend models.py ----------

type BackendMode =
  | "PATROL"
  | "RETURNING"
  | "IDLE_AT_BASE"
  | "TRANSIT_TO_AREA"
  | "CHARGING"
  | "LOST";

interface DroneDTO {
  id: string;
  side: "friendly" | "enemy";
  path_param: number;
  battery: number;
  mode: BackendMode;
  position: {
    lng: number;
    lat: number;
  };
}

interface HomeBaseDTO {
  id: string;
  position: {
    lng: number;
    lat: number;
  };
}

type EventType = "SUSPICIOUS" | "LOST";

interface EventDTO {
  id: string;
  drone_id: string;
  type: EventType;
  position: {
    lng: number;
    lat: number;
  };
  message: string;
  timestamp: number;
}

interface WorldStateDTO {
  drones: DroneDTO[];
  home_base: HomeBaseDTO;
  events: EventDTO[];
}

// ---------- helpers (distance etc.) ----------

const toRad = (deg: number) => (deg * Math.PI) / 180;

// rough haversine distance in km
const distanceKm = (a: LngLat, b: LngLat): number => {
  const R = 6371; // km
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
};

const formatKm = (km: number | null): string => {
  if (km == null) return "–";
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  return `${km.toFixed(1)} km`;
};

const modeBadgeStyle = (mode: DroneEntity["mode"]) => {
  let bg = "#4caf50"; // default PATROL
  if (mode === "RETURNING") bg = "#2196f3";

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    background: bg,
    color: "#ffffff",
    textTransform: "uppercase" as const,
  };
};

// ------------------------------------------------------------

export const MapView: React.FC<MapViewProps> = ({ targetCenter }) => {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderEngine | null>(null);
  const worldRef = useRef<WorldState>(createInitialWorldState());

  // selection
  const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
  const [selectedDrone, setSelectedDrone] = useState<DroneEntity | null>(null);
  const selectedDroneIdRef = useRef<string | null>(null);

  const [isDroneViewOpen, setIsDroneViewOpen] = useState(false);

  // home base info
  const [baseDroneCount, setBaseDroneCount] = useState<number>(0);

  // distance of selected drone to base (in km)
  const [selectedDistanceKm, setSelectedDistanceKm] = useState<number | null>(
    null
  );

  // events and event log
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [eventLog, setEventLog] = useState<EventDTO[]>([]);

  const drawRef = useRef<MapboxDraw | null>(null);
  const pollingRef = useRef<number | null>(null);

  // keep a ref in sync with selectedDroneId for use inside polling closure
  useEffect(() => {
    selectedDroneIdRef.current = selectedDroneId;
  }, [selectedDroneId]);

  // Helper: map backend mode -> our frontend DroneMode union
  const mapMode = (m: BackendMode): DroneEntity["mode"] => {
    if (m === "PATROL" || m === "RETURNING") return m;
    // For visualization we treat other backend phases as PATROL-ish
    return "PATROL";
  };

  // Helper: convert backend DTO -> internal WorldState
  const dtoToWorldState = (dto: WorldStateDTO): WorldState => {
    return {
      drones: dto.drones.map((d): DroneEntity => ({
        id: d.id,
        side: d.side,
        pathParam: d.path_param,
        battery: d.battery,
        mode: mapMode(d.mode),
        position: [d.position.lng, d.position.lat] as LngLat,
        offset: 0,
      })),
      homeBase: {
        id: dto.home_base.id,
        position: [
          dto.home_base.position.lng,
          dto.home_base.position.lat,
        ] as LngLat,
      },
    };
  };

  // Helper: how many drones are currently "at base"
  const countDronesAtBase = (world: WorldState): number => {
    const [bx, by] = world.homeBase.position;
    const THRESHOLD = 0.001; // rough radius in degrees

    return world.drones.reduce((acc, d) => {
      const dx = d.position[0] - bx;
      const dy = d.position[1] - by;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist < THRESHOLD ? acc + 1 : acc;
    }, 0);
  };

  // Helper: update the highlighted drone on the map
  const updateHighlight = (drone: DroneEntity | null) => {
    const map = mapRef.current;
    if (!map) return;

    const src = map.getSource(
      "selected-drone"
    ) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;

    if (!drone) {
      src.setData({
        type: "FeatureCollection",
        features: [],
      });
      return;
    }

    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: drone.id },
          geometry: {
            type: "Point",
            coordinates: drone.position,
          },
        },
      ],
    });
  };

  // Helper: update suspicious / lost event layers
  const updateEventLayers = () => {
    const map = mapRef.current;
    if (!map) return;

    const suspicious = events.filter((e) => e.type === "SUSPICIOUS");
    const lost = events.filter((e) => e.type === "LOST");

    const suspiciousSrc = map.getSource(
      "suspicious-events"
    ) as mapboxgl.GeoJSONSource | undefined;
    const lostSrc = map.getSource(
      "lost-events"
    ) as mapboxgl.GeoJSONSource | undefined;

    if (suspiciousSrc) {
      suspiciousSrc.setData({
        type: "FeatureCollection",
        features: suspicious.map((e) => ({
          type: "Feature",
          properties: { id: e.id, droneId: e.drone_id },
          geometry: {
            type: "Point",
            coordinates: [e.position.lng, e.position.lat],
          },
        })),
      });
    }

    if (lostSrc) {
      lostSrc.setData({
        type: "FeatureCollection",
        features: lost.map((e) => ({
          type: "Feature",
          properties: { id: e.id, droneId: e.drone_id },
          geometry: {
            type: "Point",
            coordinates: [e.position.lng, e.position.lat],
          },
        })),
      });
    }
  };

  // keep event layers in sync with events state
  useEffect(() => {
    updateEventLayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // ---------- Initial map + Draw setup ----------
  useEffect(() => {
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string;
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      // satellite imagery
      style: "mapbox://styles/mapbox/satellite-streets-v12",
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
    map.addControl(draw, "bottom-right");
    drawRef.current = draw;

    // Home base marker (visual only – backend also knows the base)
    // Home base marker (visual only – backend also knows the base)
const baseEl = document.createElement("img");
baseEl.src = "/home.png";
baseEl.alt = "Home base";

baseEl.style.width = "32px";   // tweak size as you like
baseEl.style.height = "32px";
baseEl.style.borderRadius = "50%";         // optional: make it round
baseEl.style.boxShadow = "0 0 8px rgba(0,0,0,0.6)";


new mapboxgl.Marker({ element: baseEl })
  .setLngLat(KYIV_BASE)
  .addTo(map);

    map.on("load", () => {
      const engine = new RenderEngine(map, worldRef.current);
      engineRef.current = engine;

      // Always register drones layer; it will be empty until backend sends drones
      engine.registerLayer(createDronesLayerDescriptor());
      engine.update({ zoom: map.getZoom() });

      // --- Selected drone highlight layer ---
      map.addSource("selected-drone", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer({
        id: "selected-drone-layer",
        type: "circle",
        source: "selected-drone",
        paint: {
          "circle-radius": 4,
          "circle-color": "#FF5C00",
          "circle-opacity": 0.7,
          "circle-stroke-width": 5,
          "circle-stroke-color": "#ffffff",
        },
      });

      // --- Suspicious events layer ---
      map.addSource("suspicious-events", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer({
        id: "suspicious-events-layer",
        type: "circle",
        source: "suspicious-events",
        paint: {
          "circle-radius": 8,
          "circle-color": "#ffcc00",
          "circle-opacity": 0.9,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#000000",
        },
      });

      // --- Lost drones layer ---
      map.addSource("lost-events", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer({
        id: "lost-events-layer",
        type: "circle",
        source: "lost-events",
        paint: {
          "circle-radius": 10,
          "circle-color": "#ff1744",
          "circle-opacity": 0.9,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
    });

    // When operator draws/updates/deletes polygon, notify backend
    const handleDrawChange = () => {
      const d = draw.getAll();
      if (!d.features.length) return;

      const feature = d.features[0];
      if (feature.geometry.type !== "Polygon") return;

      const coords = feature.geometry.coordinates[0] as [number, number][];
      if (!coords || coords.length < 4) return;

      // Drop duplicate last coordinate from Mapbox Draw ring
      const path: LngLat[] = coords
        .slice(0, -1)
        .map((c) => [c[0], c[1]] as LngLat);

      const sendPolygon = async () => {
        try {
          const body = {
            polygon: path.map(([lng, lat]) => ({ lng, lat })),
            num_active: 10, // number of drones we want patrolling
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

          // update base drone count
          setBaseDroneCount(countDronesAtBase(newWorld));

          // events
          setEvents(dto.events);
          setEventLog((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            const newOnes = dto.events.filter((e) => !seen.has(e.id));
            const merged = [...prev, ...newOnes];
            return merged.slice(-30);
          });

          // keep selected drone & highlight in sync immediately if one is selected
          const currentSelectedId = selectedDroneIdRef.current;
          if (currentSelectedId) {
            const fresh =
              newWorld.drones.find((dr) => dr.id === currentSelectedId) || null;
            setSelectedDrone(fresh);

            if (fresh) {
              const basePos = newWorld.homeBase.position as LngLat;
              setSelectedDistanceKm(
                distanceKm(fresh.position as LngLat, basePos)
              );
            } else {
              setSelectedDistanceKm(null);
            }

            updateHighlight(fresh);
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

    // Click handler: select drone from drones-layer
    map.on("click", "drones-layer", (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;

      const id = feature.properties.id as string | undefined;
      if (!id) return;

      const world = worldRef.current;
      const drone = world.drones.find((d) => d.id === id) || null;

      setSelectedDroneId(id);
      setSelectedDrone(drone);
      setIsDroneViewOpen(false); // reset camera view on new selection
      updateHighlight(drone || null);

      if (drone) {
        const basePos = world.homeBase.position as LngLat;
        setSelectedDistanceKm(distanceKm(drone.position as LngLat, basePos));
      } else {
        setSelectedDistanceKm(null);
      }
    });

    // Click on suspicious event marker
    map.on("click", "suspicious-events-layer", (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;

      const droneId = feature.properties.droneId as string | undefined;
      if (!droneId) return;

      const world = worldRef.current;
      const drone = world.drones.find((d) => d.id === droneId) || null;

      if (drone) {
        setSelectedDroneId(drone.id);
        setSelectedDrone(drone);
        setIsDroneViewOpen(false);
        updateHighlight(drone);

        map.flyTo({
          center: drone.position as LngLat,
          zoom: 14,
          essential: true,
        });

        const basePos = world.homeBase.position as LngLat;
        setSelectedDistanceKm(distanceKm(drone.position as LngLat, basePos));
      }
    });

    // Click on lost drone marker
    map.on("click", "lost-events-layer", (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;

      const droneId = feature.properties.droneId as string | undefined;
      if (!droneId) return;

      const world = worldRef.current;
      const drone = world.drones.find((d) => d.id === droneId) || null;

      if (drone) {
        setSelectedDroneId(drone.id);
        setSelectedDrone(drone);
        setIsDroneViewOpen(false);
        updateHighlight(drone);

        map.flyTo({
          center: drone.position as LngLat,
          zoom: 14,
          essential: true,
        });

        const basePos = world.homeBase.position as LngLat;
        setSelectedDistanceKm(distanceKm(drone.position as LngLat, basePos));
      }
    });

    // Click empty map: clear selection
    map.on("click", (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ["drones-layer", "suspicious-events-layer", "lost-events-layer"],
      });
      if (!features.length) {
        setSelectedDroneId(null);
        setSelectedDrone(null);
        setSelectedDistanceKm(null);
        setIsDroneViewOpen(false);
        updateHighlight(null);
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

  // ---------- Poll backend world-state ----------
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

        // update base drone count
        setBaseDroneCount(countDronesAtBase(newWorld));

        // events
        setEvents(dto.events);
        setEventLog((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          const newOnes = dto.events.filter((e) => !seen.has(e.id));
          const merged = [...prev, ...newOnes];
          return merged.slice(-30);
        });

        // Refresh selected drone info & highlight on each poll
        const currentSelectedId = selectedDroneIdRef.current;
        if (currentSelectedId) {
          const fresh =
            newWorld.drones.find((d) => d.id === currentSelectedId) || null;
          setSelectedDrone(fresh);

          if (fresh) {
            const basePos = newWorld.homeBase.position as LngLat;
            setSelectedDistanceKm(
              distanceKm(fresh.position as LngLat, basePos)
            );
          } else {
            setSelectedDistanceKm(null);
          }

          updateHighlight(fresh);
        } else {
          setSelectedDistanceKm(null);
          updateHighlight(null);
        }
      } catch (err) {
        console.error("poll /api/world-state failed", err);
      }
    };

    const id = window.setInterval(poll, 400); // ~2.5 Hz
    pollingRef.current = id;

    // immediate first poll
    void poll();

    return () => {
      window.clearInterval(id);
    };
  }, []);

  // ---------- Fly to searched location from MainView ----------
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

      {/* Home base status panel */}
      <div
        style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          zIndex: 20,
          background: "rgba(10,18,28,0.95)",
          color: "#ffffff",
          padding: "8px 12px",
          borderRadius: 8,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: 12,
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          width: 260,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Home Base</div>
        <div style={{ marginBottom: 6 }}>Drones at base: {baseDroneCount}</div>

        <div
          style={{
            marginTop: 6,
            borderTop: "1px solid rgba(255,255,255,0.1)",
            paddingTop: 6,
          }}
        >
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              opacity: 0.8,
              marginBottom: 4,
            }}
          >
            Events
          </div>
          <div
            style={{
              maxHeight: 120,
              overflowY: "auto",
              fontSize: 11,
            }}
          >
            {eventLog.length === 0 && (
              <div style={{ opacity: 0.6 }}>No recent events</div>
            )}
            {eventLog
              .slice()
              .reverse()
              .map((evt) => (
                <div
                  key={evt.id}
                  style={{
                    marginBottom: 4,
                    padding: "3px 4px",
                    borderRadius: 4,
                    background:
                      evt.type === "SUSPICIOUS"
                        ? "rgba(255,193,7,0.1)"
                        : "rgba(244,67,54,0.1)",
                    border:
                      evt.type === "SUSPICIOUS"
                        ? "1px solid rgba(255,193,7,0.35)"
                        : "1px solid rgba(244,67,54,0.45)",
                    cursor: "default",
                  }}
                >
                  <strong>
                    {evt.type === "SUSPICIOUS" ? "⚠️" : "✖️"} {evt.drone_id}
                  </strong>
                  <span style={{ opacity: 0.9 }}> – {evt.message}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {selectedDrone && (
        <div className="drone-panel">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <h3 style={{ margin: 0 }}>Drone: {selectedDrone.id}</h3>
            <span style={modeBadgeStyle(selectedDrone.mode)}>
              {selectedDrone.mode}
            </span>
          </div>

          <div style={{ fontSize: 12, opacity: 0.9 }}>
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11, marginBottom: 2 }}>Battery</div>
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: "#1b2634",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${selectedDrone.battery * 100}%`,
                    height: "100%",
                    borderRadius: 999,
                    background:
                      selectedDrone.battery > 0.5
                        ? "#4caf50"
                        : selectedDrone.battery > 0.2
                        ? "#ffb300"
                        : "#f44336",
                    transition: "width 0.2s linear",
                  }}
                />
              </div>
              <div style={{ fontSize: 11, marginTop: 2, opacity: 0.8 }}>
                {(selectedDrone.battery * 100).toFixed(0)}%
              </div>
            </div>

            <div style={{ marginBottom: 2 }}>
              <strong>Position:</strong>{" "}
              {selectedDrone.position[0].toFixed(4)},{" "}
              {selectedDrone.position[1].toFixed(4)}
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Distance to base:</strong>{" "}
              {formatKm(selectedDistanceKm)}
            </div>
          </div>

          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button
              onClick={() => setIsDroneViewOpen(true)}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                cursor: "pointer",
                background: "#b21010ff",
                color: "#ffffff",
                border: "none",
              }}
            >
              Live
            </button>
            <button
              onClick={() => {
                setSelectedDroneId(null);
                setSelectedDrone(null);
                setSelectedDistanceKm(null);
                setIsDroneViewOpen(false);
                updateHighlight(null);
              }}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Close
            </button>
            <button
            style={{
                padding: "4px 8px",
                borderRadius: 4,
                cursor: "pointer",
              }}>
                Control
              </button>
          </div>
        </div>
      )}

      {isDroneViewOpen && selectedDrone && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: "#0a121c",
              padding: 16,
              borderRadius: 8,
              maxWidth: "80vw",
              maxHeight: "80vh",
              boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
              color: "#fff",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h4 style={{ margin: 0 }}>Camera view – {selectedDrone.id}</h4>
              <button
                onClick={() => setIsDroneViewOpen(false)}
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  cursor: "pointer",
                  border: "none",
                }}
              >
                ✕
              </button>
            </div>

            <img
              src={DRONE_VIEW_IMAGE}
              alt="Drone camera view"
              style={{
                maxWidth: "100%",
                maxHeight: "70vh",
                borderRadius: 6,
                objectFit: "cover",
              }}
            />
          </div>
        </div>
      )}
    </>
  );
};