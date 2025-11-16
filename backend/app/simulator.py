# app/core/simulator.py
from __future__ import annotations
from typing import List, Optional
from .models import (
    LngLat,
    DroneDTO,
    HomeBaseDTO,
    WorldStateResponse,
    PatrolAreaRequest,
)

class Simulator:
    def __init__(self) -> None:
        # world
        self.home_base = HomeBaseDTO(
            id="home-1",
            position=LngLat(lng=36.3694, lat=47.5931),
        )

        # make a pool of drones at base
        self.drones: List[DroneDTO] = []
        for i in range(20):
            self.drones.append(
                DroneDTO(
                    id=f"drone-{i}",
                    position=self.home_base.position,
                    side="friendly",
                    path_param=0.0,
                    battery=1.0,
                    mode="IDLE_AT_BASE",
                    phase_progress=0.0,
                )
            )

        # simulation time
        self.sim_time: float = 0.0

        # patrol area config
        self.patrol_polygon: Optional[List[LngLat]] = None
        self.patrol_center: Optional[LngLat] = None
        self.num_active: int = 0

        # launch schedule
        self.launch_interval: float = 5.0     # 5 seconds between launches
        self.time_to_area: float = 30.0       # 30s flight base → center (tune)
        self.next_launch_index: int = 0       # which drone from pool to launch next

    # -------------------------------------------------
    # This is the function you asked for
    # -------------------------------------------------
    def set_patrol_area(self, req: PatrolAreaRequest) -> None:
        """
        Called once when the operator defines/updates the patrol polygon.

        It:
        - stores the polygon
        - computes its center
        - schedules drones to launch one after another from home base
        """
        self.patrol_polygon = req.polygon
        self.num_active = req.num_active

        # simple centroid: average of vertices (good enough for demo)
        lng_sum = sum(p.lng for p in req.polygon)
        lat_sum = sum(p.lat for p in req.polygon)
        n = len(req.polygon)
        self.patrol_center = LngLat(lng=lng_sum / n, lat=lat_sum / n)

        # reset timing
        self.sim_time = 0.0
        self.next_launch_index = 0

        # reset all drones to “at base”
        for d in self.drones:
            d.position = self.home_base.position
            d.mode = "IDLE_AT_BASE"
            d.phase_progress = 0.0
            d.path_param = 0.0
            d.battery = 1.0

    # -------------------------------------------------
    # Simulation step – call this regularly (e.g. 10x/sec)
    # -------------------------------------------------
    def step(self, dt: float) -> None:
        self.sim_time += dt

        if not self.patrol_center:
            return  # nothing to do yet

        # 1) Launch new drones from base at 5s intervals
        while (
            self.next_launch_index < self.num_active
            and self.sim_time >= self.next_launch_index * self.launch_interval
        ):
            d = self.drones[self.next_launch_index]
            if d.mode in ("IDLE_AT_BASE", "CHARGING"):
                d.mode = "TRANSIT_TO_AREA"
                d.phase_progress = 0.0
            self.next_launch_index += 1

        # 2) Update all drones according to their mode
        for d in self.drones:
            if d.mode == "TRANSIT_TO_AREA":
                # move from base → center over time_to_area seconds
                d.phase_progress = min(1.0, d.phase_progress + dt / self.time_to_area)
                t = d.phase_progress

                bx, by = self.home_base.position.lng, self.home_base.position.lat
                cx, cy = self.patrol_center.lng, self.patrol_center.lat

                d.position = LngLat(
                    lng=bx + (cx - bx) * t,
                    lat=by + (cy - by) * t,
                )

                if d.phase_progress >= 1.0:
                    d.mode = "PATROL"
                    d.path_param = 0.0  # you can now use this for your intra-polygon patrol logic
            elif d.mode == "PATROL" and d.battery < 0.2:
                d.mode = "CHARGING"
                d.phase_progress = 0.0
            elif d.mode == "PATROL":
                # here you later add your “spread evenly in polygon / random walk” logic
                # for now, just slowly move path_param so it looks alive
                d.path_param = (d.path_param + 0.05 * dt) % 1.0

            # (RETURNING, CHARGING etc. go here later)

    def get_world_state(self) -> WorldStateResponse:
        return WorldStateResponse(
            drones=self.drones,
            home_base=self.home_base,
        )
    
simulator = Simulator()