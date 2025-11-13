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
    pathParam
});

// Create sample drones around New York
// Later, this data will come from backend
export const createInitialWorldState = (): WorldState => {
  const base: LngLat = [-74.0, 40.7];
  const drones: DroneEntity[] = [];
  const count = 20;

  for (let i = 0; i < count; i++) {
    const offsetLng = (Math.random() - 0.5) * 0.05;
    const offsetLat = (Math.random() - 0.5) * 0.05;
    const p0: LngLat = [base[0] + offsetLng, base[1] + offsetLat];

    drones.push(
      makeDrone(
        i,
        p0,
        i % 2 === 0 ? "friendly" : "enemy",
        i / count // spread 0..1 around the loop
      )
    );
  }

  return { drones };
};