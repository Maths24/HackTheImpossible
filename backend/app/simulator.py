# app/core/simulator.py
from __future__ import annotations
from typing import List, Optional
import math
import random  # <--- ADD THIS

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
        self.time_to_area: float = 5.0       # 30s flight base → center (tune)
        self.next_launch_index: int = 0       # which drone from pool to launch next

        # swarm parameters inside polygon
        self.neighbor_gain: float = 0.5       # how strongly drones react to neighbors
        self.center_gain: float = 0.05        # how strongly they are pulled to polygon center
        self.max_speed_deg_per_sec: float = 0.001  # max position change in degrees per second

    # -------------------------------------------------
    # Utility: distance between two positions (in degrees)
    # (good enough for local behavior in a small polygon)
    # -------------------------------------------------
    @staticmethod
    def _distance(a: LngLat, b: LngLat) -> float:
        dx = a.lng - b.lng
        dy = a.lat - b.lat
        return math.sqrt(dx * dx + dy * dy)

    # -------------------------------------------------
    # Very simple point-in-polygon (ray casting)
    # Used only to keep drones roughly inside the area.
    # -------------------------------------------------
    @staticmethod
    def _point_in_polygon(p: LngLat, poly: List[LngLat]) -> bool:
        inside = False
        n = len(poly)
        if n < 3:
            return False

        x, y = p.lng, p.lat
        for i in range(n):
            j = (i - 1) % n
            xi, yi = poly[i].lng, poly[i].lat
            xj, yj = poly[j].lng, poly[j].lat

            intersect = ((yi > y) != (yj > y)) and (
                x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi
            )
            if intersect:
                inside = not inside
        return inside

    # -------------------------------------------------
    # Compute a "target spacing" from polygon size + number of patrol drones
    # This is heuristic, but good enough for a demo.
    # -------------------------------------------------
    def _desired_spacing(self, patrol_indices: List[int]) -> float:
        if not self.patrol_polygon or len(patrol_indices) <= 1:
            return 0.001  # tiny default

        xs = [p.lng for p in self.patrol_polygon]
        ys = [p.lat for p in self.patrol_polygon]
        width = max(xs) - min(xs)
        height = max(ys) - min(ys)
        n = len(patrol_indices)

        # Rough idea: area ~ width*height, spacing ~ sqrt(area / n)
        area_est = max(width * height, 1e-9)
        return 0.5 * math.sqrt(area_est / n)

    # -------------------------------------------------
    # Local swarm behavior inside the polygon:
    # each PATROL drone looks at its two nearest PATROL neighbors
    # and moves to equalize the distance, plus weak pull to center.
    # -------------------------------------------------
    def _update_patrol_swarm(self, dt: float) -> None:
        if not self.patrol_polygon or not self.patrol_center:
            return

        # indices of patrol drones
        patrol_indices = [i for i, d in enumerate(self.drones) if d.mode == "PATROL"]
        if len(patrol_indices) == 0:
            return

        desired = self._desired_spacing(patrol_indices)
        if desired <= 0:
            return

        # store new positions separately so updates are "synchronous"
        new_positions: List[LngLat] = [d.position for d in self.drones]

        cx, cy = self.patrol_center.lng, self.patrol_center.lat

        for idx in patrol_indices:
            d = self.drones[idx]
            px, py = d.position.lng, d.position.lat

            # find two nearest patrol neighbors
            distances: List[tuple[float, int]] = []
            for j in patrol_indices:
                if j == idx:
                    continue
                dist = self._distance(d.position, self.drones[j].position)
                distances.append((dist, j))

            distances.sort(key=lambda x: x[0])
            neighbors = [j for (dist, j) in distances[:2]]

            fx = 0.0
            fy = 0.0

            # neighbor spacing forces
            for j in neighbors:
                neighbor = self.drones[j]
                nx, ny = neighbor.position.lng, neighbor.position.lat

                # vector from self -> neighbor
                dx = nx - px
                dy = ny - py
                dist = math.sqrt(dx * dx + dy * dy) + 1e-9

                # if dist > desired -> pull towards neighbor
                # if dist < desired -> push away
                factor = (dist - desired) / dist

                fx += self.neighbor_gain * factor * dx
                fy += self.neighbor_gain * factor * dy

            # weak pull towards polygon center
            #fx += self.center_gain * (cx - px)
            fy += self.center_gain * (cy - py)

            # tiny random jitter
            jitter = 0.00005
            fx += jitter * (random.random() - 0.5)
            fy += jitter * (random.random() - 0.5)

            # limit speed
            speed = math.sqrt(fx * fx + fy * fy)
            max_step = self.max_speed_deg_per_sec
            if speed > 0:
                scale = min(max_step, speed) / speed
                fx *= scale
                fy *= scale

            new_x = px + fx * dt
            new_y = py + fy * dt
            new_pos = LngLat(lng=new_x, lat=new_y)

            # keep roughly inside polygon – if we leave, pull back towards center
            if not self._point_in_polygon(new_pos, self.patrol_polygon):
                new_pos = LngLat(
                    lng=(px + cx) * 0.5,
                    lat=(py + cy) * 0.5,
                )

            new_positions[idx] = new_pos

        # apply new positions
        for i in patrol_indices:
            self.drones[i].position = new_positions[i]

    # -------------------------------------------------
    # This is the function you asked for (polygon + launch setup)
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

        # 2) Update all drones according to their mode (movement between phases)
        for d in self.drones:
            if d.mode == "TRANSIT_TO_AREA":
                # move from base → center over time_to_area seconds
                d.phase_progress = min(1.0, d.phase_progress + dt / self.time_to_area)
                t = d.phase_progress

                bx, by = self.home_base.position.lng, self.home_base.position.lat
                cx, cy = self.patrol_center.lng, self.patrol_center.lat

                # proposed new position along the line base → center
                new_pos = LngLat(
                    lng=bx + (cx - bx) * t,
                    lat=by + (cy - by) * t,
                )
                d.position = new_pos

                # 👉 as soon as the drone enters the polygon, it joins the swarm
                if self.patrol_polygon and self._point_in_polygon(new_pos, self.patrol_polygon):
                    d.mode = "PATROL"
                    d.path_param = 0.0  # now just a dummy progress value

                # fallback: if it never hits polygon but finishes the transit time,
                # still switch to PATROL (old behavior)
                elif d.phase_progress >= 1.0:
                    d.mode = "PATROL"
                    d.path_param = 0.0

            elif d.mode == "PATROL" and d.battery < 0.2:
                d.mode = "CHARGING"
                d.phase_progress = 0.0

            elif d.mode == "PATROL":
                # battery drain while on patrol
                d.battery = max(0.0, d.battery - 0.01 * dt)

            # (RETURNING, CHARGING etc. can be added here later)

        # 3) Local swarm behavior for PATROL drones inside the polygon
        self._update_patrol_swarm(dt)
    def get_world_state(self) -> WorldStateResponse:
        return WorldStateResponse(
            drones=self.drones,
            home_base=self.home_base,
        )

simulator = Simulator()