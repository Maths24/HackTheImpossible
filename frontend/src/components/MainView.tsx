import { useEffect, useState } from "react";
import { MapView } from "./MapView";

export const MainView = () => {
  const operatorPos: [number, number] = [-73.9857, 40.7484];

  const [timeString, setTimeString] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // This is what we send down to MapView when search succeeds
  const [targetCenter, setTargetCenter] = useState<[number, number] | null>(
    null
  );

  useEffect(() => {
    const update = () => setTimeString(new Date().toLocaleDateString());
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query) return;

    setIsSearching(true);
    setSearchError(null);

    try {
      const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string;
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        query
      )}.json?access_token=${token}&limit=1`;

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Geocoding request failed");
      }

      const data = await res.json();
      if (!data.features || data.features.length === 0) {
        setSearchError("No results found");
        return;
      }

      const [lng, lat] = data.features[0].center as [number, number];
      setTargetCenter([lng, lat]);
    } catch (err) {
      console.error(err);
      setSearchError("Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === "Enter") {
      void handleSearch();
    }
  };

  return (
    <>
      <div className="status-bar">
        <div className="status-left">
          Operator:&nbsp;
          {operatorPos[1].toFixed(4)}°, {operatorPos[0].toFixed(4)}°
        </div>

        <div className="status-center">
          DEMO MODE - Simulated Environment
          {/* inline search in the middle for the demo */}
          <span className="status-search">
            <input
              type="text"
              placeholder="Jump to location (e.g. Lviv)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              disabled={isSearching}
            />
            <button onClick={handleSearch} disabled={isSearching}>
              {isSearching ? "…" : "Go"}
            </button>
          </span>
          {searchError && (
            <span className="status-search-error">{searchError}</span>
          )}
        </div>

        <div className="status-right">{timeString}</div>
      </div>

      {/* Pass targetCenter down to the map */}
      <MapView targetCenter={targetCenter} />
    </>
  );
};