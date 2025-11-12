import type { WorldState, DroneEntity, DroneSide, LngLat } from "./types";

// Helper to create a drone
const makeDrone = (id: number, position: LngLat, side: DroneSide): DroneEntity => ({
  id: `drone-${id}`,
  position,
  side
});

// Create sample drones around New York
// Later, this data will come from backend
export const createInitialWorldState = (): WorldState => {
    const base: LngLat = [-74.0, 40.7];
    const base2: LngLat = [12.35, 48.06];

    const drones: DroneEntity[] = [];

    for (let i = 0; i < 200; i++) {
        const offsetLng = (Math.random() - 0.5) * 0.2;
        const offsetLat = (Math.random() - 0.5) * 0.2;

        drones.push(
            makeDrone(
                i,
                [base[0] + offsetLng, base[1] + offsetLat],
                i % 3 === 0 ? "friendly" : "enemy"
            )
        );
        drones.push(
            makeDrone(
                i+300,
                [base2[0] + offsetLng, base2[1] + offsetLat],
                i % 2 === 0 ? "friendly" : "enemy"
            )
        );
    }

    return { drones };
}