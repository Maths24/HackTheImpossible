import type { WorldState, DroneEntity, DroneSide, LngLat } from "./types";

// Helper to create a drone
const makeDrone = (
  id: number,
  position: LngLat,
  side: DroneSide,
  pathParam: number
): DroneEntity => ({
  id: `drone-${id}`,
  position,
  side,
  pathParam,
  battery: 1,          // full battery at start
  mode: "PATROL",      // default mode
  offset: 0,           // no lateral offset yet
  exploration: 0       // start with 0% explored
});

export const createInitialWorldState = (): WorldState => {
  const base: LngLat = [36.3694, 47.5931]; // same as KYIV_BASE
  const drones: DroneEntity[] = [];
  const count = 20;

  for (let i = 0; i < count; i++) {
    const offsetLng = (Math.random() - 0.5) * 0.01;
    const offsetLat = (Math.random() - 0.5) * 0.01;
    const p0: LngLat = [base[0] + offsetLng, base[1] + offsetLat];

    drones.push(
      makeDrone(
        i,
        p0,
        i % 2 === 0 ? "friendly" : "enemy",
        i / count // initial spread along path
      )
    );
  }

  return {
    drones,
    homeBase: {
      id: "base-1",
      position: base,
      rangeKm: 10
    }
  };
};