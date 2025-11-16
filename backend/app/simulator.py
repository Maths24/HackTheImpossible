# app/core/simulator.py
from __future__ import annotations
from typing import List, Optional
import math
import random

from .models import (
    LngLat,
    DroneDTO,
    HomeBaseDTO,
    WorldStateResponse,
    PatrolAreaRequest,
    EventDTO,
)


class Simulator:
    def __init__(self) -> None:
        # ---------------- world setup ----------------36.255577, 47.464746
        self.home_base = HomeBaseDTO(
            id="home-1",
            position=LngLat(lng=36.255577, lat=47.464746),
        )

        # pool of drones at base
        self.drones: List[DroneDTO] = []
        for i in range(20):
            self.drones.append(
                DroneDTO(
                    id=f"drone-{i}",
                    position=self.home_base.position,
                    side="friendly",
                    path_param=0.0,
                    battery=1.0 + random.random() * 0.5,
                    mode="IDLE_AT_BASE",
                    phase_progress=0.0,
                )
            )

        # simulation time
        self.sim_time: float = 0.0

        # patrol area config
        self.patrol_polygon: Optional[List[LngLat]] = None
        self.patrol_center: Optional[LngLat] = None
        self.num_active: int = 0  # target number of active drones in the field
        self.has_patrol_area: bool = False  # to distinguish first vs reshape

        # launch schedule
        self.launch_interval: float = 1.0   # seconds between launches (initial + backup)
        self.time_to_area: float = 5.0      # flight time base → center (seconds)

        # global launch timing (for all launches)
        self.last_launch_time: float = -1e9  # so first launch can happen immediately

        # swarm parameters inside polygon
        self.neighbor_gain: float = 0.5           # how strongly drones react to neighbors
        self.center_gain: float = 0.0             # pull to polygon center (0 = off)
        self.max_speed_deg_per_sec: float = 0.001  # max position change (deg/sec)

        # event stream (for UI)
        self.events: List[EventDTO] = []
        self.next_event_id: int = 0

        # scripted demo behavior
        self.alert_drone_id: str = "drone-1"
        self.lost_drone_id: str = "drone-2"
        self.alert_triggered: bool = False
        self.lost_triggered: bool = False
        self.alert_position: Optional[LngLat] = None

    # -------------------------------------------------
    # Utility: distance between two positions (in degrees)
    # -------------------------------------------------
    @staticmethod
    def _distance(a: LngLat, b: LngLat) -> float:
        dx = a.lng - b.lng
        dy = a.lat - b.lat
        return math.sqrt(dx * dx + dy * dy)

    # -------------------------------------------------
    # Push an event into the event buffer
    # -------------------------------------------------
    def _push_event(
        self,
        drone_id: str,
        evt_type: str,
        position: LngLat,
        message: str,
    ) -> None:
        """
        evt_type e.g.: "SUSPICIOUS", "LOST", "RECHARGING"
        """
        evt = EventDTO(
            id=f"evt-{self.next_event_id}",
            drone_id=drone_id,
            type=evt_type,
            position=position,
            message=message,
            timestamp=self.sim_time,
        )
        self.next_event_id += 1
        self.events.append(evt)

        # keep only last N events so payload stays small
        MAX_EVENTS = 50
        if len(self.events) > MAX_EVENTS:
            self.events = self.events[-MAX_EVENTS:]

    # -------------------------------------------------
    # Very simple point-in-polygon (ray casting)
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
    # Heuristic desired spacing from polygon size + #patrol drones
    # -------------------------------------------------
    def _desired_spacing(self, patrol_indices: List[int]) -> float:
        if not self.patrol_polygon or len(patrol_indices) <= 1:
            return 0.001  # tiny default

        xs = [p.lng for p in self.patrol_polygon]
        ys = [p.lat for p in self.patrol_polygon]
        width = max(xs) - min(xs)
        height = max(ys) - min(ys)
        n = len(patrol_indices)

        area_est = max(width * height, 1e-9)
        return 0.5 * math.sqrt(area_est / n)

    # -------------------------------------------------
    # Local swarm behavior inside polygon:
    # PATROL drones repel neighbors (Poisson-disc-ish)
    # -------------------------------------------------
    def _update_patrol_swarm(self, dt: float) -> None:
        """
        2D swarm spacing inside the polygon.

        - PATROL drones repel nearby PATROL neighbors.
        - Optional weak pull toward polygon center.
        - Tiny jitter to avoid symmetric deadlocks.
        - Movement clamped and kept inside polygon.
        """
        if not self.patrol_polygon or not self.patrol_center:
            return

        patrol_indices = [i for i, d in enumerate(self.drones) if d.mode == "PATROL"]
        if len(patrol_indices) == 0:
            return

        desired = self._desired_spacing(patrol_indices)
        if desired <= 0:
            return

        K_NEIGHBORS = 5  # how many neighbors each drone considers

        new_positions: List[LngLat] = [d.position for d in self.drones]

        cx, cy = self.patrol_center.lng, self.patrol_center.lat

        for idx in patrol_indices:
            d = self.drones[idx]

            # DEMO: keep the alert drone hovering at its alert position once triggered
            if self.alert_triggered and d.id == self.alert_drone_id and self.alert_position:
                new_positions[idx] = self.alert_position
                continue

            px, py = d.position.lng, d.position.lat

            fx = 0.0
            fy = 0.0

            # ---- neighbor repulsion in 2D ----
            distances: List[tuple[float, int]] = []
            for j in patrol_indices:
                if j == idx:
                    continue
                dist = self._distance(d.position, self.drones[j].position)
                distances.append((dist, j))

            distances.sort(key=lambda x: x[0])
            for dist, j in distances[:K_NEIGHBORS]:
                if dist < 1e-9:
                    continue

                # only react if closer than 1.5 * desired
                if dist >= 1.5 * desired:
                    continue

                n = self.drones[j]
                vx = px - n.position.lng
                vy = py - n.position.lat

                inv = 1.0 / dist
                ux = vx * inv
                uy = vy * inv

                # repulsion strength: stronger when close, fades out
                strength = (1.5 * desired - dist) / (1.5 * desired)
                fx += self.neighbor_gain * strength * ux
                fy += self.neighbor_gain * strength * uy

            # ---- optional pull to center (currently 0.0) ----
            fx += self.center_gain * (cx - px)
            fy += self.center_gain * (cy - py)

            # ---- tiny jitter ----
            jitter = 0.00005
            fx += jitter * (random.random() - 0.5)
            fy += jitter * (random.random() - 0.5)

            # ---- clamp speed ----
            force_mag = math.sqrt(fx * fx + fy * fy)
            if force_mag > 0.0:
                max_step = self.max_speed_deg_per_sec * dt
                scale = min(max_step, force_mag) / force_mag
                fx *= scale
                fy *= scale

            new_x = px + fx
            new_y = py + fy
            new_pos = LngLat(lng=new_x, lat=new_y)

            # keep inside polygon: if outside, pull halfway toward center
            if not self._point_in_polygon(new_pos, self.patrol_polygon):
                new_pos = LngLat(
                    lng=0.5 * (px + cx),
                    lat=0.5 * (py + cy),
                )

            new_positions[idx] = new_pos

        for i in patrol_indices:
            self.drones[i].position = new_positions[i]

    # -------------------------------------------------
    # Called when operator defines/updates patrol polygon
    # -------------------------------------------------
    def set_patrol_area(self, req: PatrolAreaRequest) -> None:
        """
        Stores polygon, computes its center.

        - On first call: full mission reset (drones back to base, events cleared).
        - On later calls: only the polygon + center change; drones keep flying
          and adapt to the new area via swarm logic.
        """
        self.patrol_polygon = req.polygon
        self.num_active = req.num_active

        if self.patrol_polygon:
            lng_sum = sum(p.lng for p in self.patrol_polygon)
            lat_sum = sum(p.lat for p in self.patrol_polygon)
            n = len(self.patrol_polygon)
            self.patrol_center = LngLat(lng=lng_sum / n, lat=lat_sum / n)
        else:
            self.patrol_center = None

        # ---- First time: full reset ----
        if not self.has_patrol_area:
            self.has_patrol_area = True

            # reset timing
            self.sim_time = 0.0
            self.last_launch_time = -1e9  # allow immediate first launch

            # reset drones to base
            for d in self.drones:
                d.position = self.home_base.position
                d.mode = "IDLE_AT_BASE"
                d.phase_progress = 0.0
                d.path_param = 0.0
                d.battery = 1.0

            # DEMO: drone-0 starts at 40% battery so it returns early
            if self.drones:
                self.drones[0].battery = 0.4

            # reset events & scripted flags
            self.events.clear()
            self.next_event_id = 0
            self.alert_triggered = False
            self.lost_triggered = False
            self.alert_position = None
        # ---- Subsequent calls: polygon reshape mid-mission ----
        else:
            # nothing else: drones keep their state and will adapt to new polygon
            pass

    # -------------------------------------------------
    # Simulation step – call this regularly (e.g. from /api/world-state)
    # -------------------------------------------------
    def step(self, dt: float) -> None:
        self.sim_time += dt

        if not self.patrol_center or not self.patrol_polygon:
            return  # nothing to do yet

        # 1) Maintain desired number of active drones with launch spacing
        ACTIVE_MODES = {"PATROL", "RETURNING", "TRANSIT_TO_AREA"}

        active_count = sum(1 for d in self.drones if d.mode in ACTIVE_MODES)
        shortage = max(0, self.num_active - active_count)

        if (
            shortage > 0
            and (self.sim_time - self.last_launch_time) >= self.launch_interval
        ):
            # launch exactly one new drone (initial wave or backup) every launch_interval
            for d in self.drones:
                if d.mode == "IDLE_AT_BASE":
                    d.mode = "TRANSIT_TO_AREA"
                    d.phase_progress = 0.0
                    self.last_launch_time = self.sim_time
                    break

        # 2) Move drones and handle per-mode logic
        for d in self.drones:
            # LOST drones stay where they are (last known position)
            if d.mode == "LOST":
                continue

            if d.mode == "TRANSIT_TO_AREA":
                # move from base → center over time_to_area seconds
                d.phase_progress = min(1.0, d.phase_progress + dt / self.time_to_area)
                t = d.phase_progress

                bx, by = self.home_base.position.lng, self.home_base.position.lat
                cx, cy = self.patrol_center.lng, self.patrol_center.lat

                new_pos = LngLat(
                    lng=bx + (cx - bx) * t,
                    lat=by + (cy - by) * t,
                )
                d.position = new_pos

                # as soon as the drone enters the polygon, it joins the swarm
                if self._point_in_polygon(new_pos, self.patrol_polygon):
                    d.mode = "PATROL"
                    d.path_param = 0.0

                # fallback: if it never hits polygon but reaches center time
                elif d.phase_progress >= 1.0:
                    d.mode = "PATROL"
                    d.path_param = 0.0

            elif d.mode == "PATROL":
                # battery drain while on patrol
                d.battery = max(0.0, d.battery - 0.01 * dt)

                # --- scripted suspicious event for demo (hover) ---
                if (
                    d.id == self.alert_drone_id
                    and not self.alert_triggered
                    and self.sim_time > 15.0  # trigger after ~15s
                ):
                    self.alert_triggered = True
                    self.alert_position = d.position
                    self._push_event(
                        d.id,
                        "SUSPICIOUS",
                        d.position,
                        "Suspicious activity detected – drone holding position.",
                    )

                # --- scripted LOST drone for demo ---
                if (
                    d.id == self.lost_drone_id
                    and not self.lost_triggered
                    and self.sim_time > 25.0  # trigger after ~25s
                ):
                    self.lost_triggered = True
                    d.mode = "LOST"
                    self._push_event(
                        d.id,
                        "LOST",
                        d.position,
                        "Drone lost – communication failure.",
                    )
                    continue  # LOST now handled at top of loop on next step

                # low-battery → return to base
                if d.battery < 0.2 and d.battery > 0.0:
                    self._push_event(
                        d.id,
                        "RECHARGING",
                        d.position,
                        "Drone returning to base for recharge.",
                    )
                    d.mode = "RETURNING"
                    d.phase_progress = 0.0

                # battery fully dead while patrolling -> lost
                if d.battery <= 0.0:
                    d.mode = "LOST"
                    self._push_event(
                        d.id,
                        "LOST",
                        d.position,
                        "Drone lost – last known position (battery drained).",
                    )

            elif d.mode == "RETURNING":
                # battery also drains (slower) while returning
                d.battery = max(0.0, d.battery - 0.005 * dt)

                # if battery dies on the way back -> lost
                if d.battery <= 0.0:
                    d.mode = "LOST"
                    self._push_event(
                        d.id,
                        "LOST",
                        d.position,
                        "Drone lost while returning to base (battery drained).",
                    )
                    continue

                # move towards home base at max_speed_deg_per_sec
                bx, by = self.home_base.position.lng, self.home_base.position.lat
                px, py = d.position.lng, d.position.lat

                dx = bx - px
                dy = by - py
                dist = math.sqrt(dx * dx + dy * dy)

                if dist < 1e-6:
                    # arrived
                    d.position = self.home_base.position
                    d.mode = "CHARGING"
                    d.phase_progress = 0.0
                else:
                    step = self.max_speed_deg_per_sec * dt
                    if step >= dist:
                        # reach base in this step
                        d.position = self.home_base.position
                        d.mode = "CHARGING"
                        d.phase_progress = 0.0
                    else:
                        ratio = step / dist
                        d.position = LngLat(
                            lng=px + dx * ratio,
                            lat=py + dy * ratio,
                        )

            elif d.mode == "CHARGING":
                # simple 2-minute full recharge
                CHARGE_TIME = 120.0  # seconds
                d.phase_progress = min(1.0, d.phase_progress + dt / CHARGE_TIME)
                if d.phase_progress >= 1.0:
                    d.battery = 1.0
                    d.mode = "IDLE_AT_BASE"
                    d.phase_progress = 0.0

            # IDLE_AT_BASE: nothing to do, will be launched by launcher logic

        # 3) Swarm behavior inside polygon (PATROL drones)
        self._update_patrol_swarm(dt)

    def get_world_state(self) -> WorldStateResponse:
        return WorldStateResponse(
            drones=self.drones,
            home_base=self.home_base,
            events=self.events,
        )


simulator = Simulator()