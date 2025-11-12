import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

export type LngLat = [number, number];

type MapViewProps = {
  /** Initial [lng, lat] the map centers on when mounted */
  initialCenter?: LngLat;
  /** Initial zoom when mounted */
  initialZoom?: number;
  /** Optional Mapbox style URL (defaults to streets) */
  styleUrl?: string;
  /** Called on any map move (drag/zoom/rotate) */
  onMove?(center: LngLat, zoom: number): void;
  /** Optional className for the container div */
  className?: string;
};

export const MapView: React.FC<MapViewProps> = ({
  initialCenter = [0, 0],
  initialZoom = 2,
  styleUrl = "mapbox://styles/mapbox/streets-v12",
  onMove,
  className
}) => {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string;

    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: initialCenter,
      zoom: initialZoom
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    const handleMove = () => {
      if (!onMove) return;
      const c = map.getCenter();
      onMove([c.lng, c.lat], map.getZoom());
    };
    map.on("move", handleMove);

    mapRef.current = map;

    return () => {
      map.off("move", handleMove);
      map.remove();
      mapRef.current = null;
    };
    // NOTE: We intentionally do NOT include initialCenter/initialZoom/styleUrl in deps,
    // so the map isn't re-created if the parent re-renders.
    // Change these into controlled props if you need live updates after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMove]);

  return <div id="map-container" ref={containerRef} className={className} />;
};