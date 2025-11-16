from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Tuple
import math
import time

from .models import (
    LngLat,
    DroneDTO,
    HomeBaseDTO,
    WorldStateResponse,
    PatrolAreaRequest,
)

# ---- parameters (you can tune these) ---------------------------------

PATH_BASE_SPEED = 0.02       # base speed along path (fraction of loop / second)
SPACING_GAIN = 0.5           # how strongly drones react to spacing
BATTERY_DRAIN_RATE = 0.02    # per second
RETURN_THRESHOLD = 0.2       # below 20% battery -> go home
HOME_PARAM = 0.0             # path position of home base (for demo: 0)

HOME_LNG = 36.3694           # Kyiv-ish example, adjust if needed
HOME_LAT = 47.5931


# ---- internal state types --------------------------------------------

@dataclass
class Drone:
    id: str
    side: str
    path_param: float     # 0..1 along patrol path
    battery: float        # 0..1
    mode: str             # "PATROL" | "RETURNING"


@dataclass
class HomeBase:
    id: str
    lng: float
    lat: float


@dataclass
class SwarmSimulator:
    home_base: HomeBase = field(
        default_factory=lambda: HomeBase(
            id="home-1",
            lng=HOME_LNG,
            lat=HOME_LAT,
        )
    )
    drones: List[Drone] = field(default_factory=list)

    # patrol path
    path: List[Tuple[float, float]] = field(default_factory=list)  # [(lng, lat)]
    seg_lengths: List[float] = field(default_factory=list)
    total_length: float = 0.0

    last_step_walltime: float = field(default_factory=time.time)

    # ---- path handling ------------------------------------------------

    def set_patrol_area(self, req: PatrolAreaRequest) -> None:
        """Called when frontend sends a new polygon."""
        coords = [(p.lng, p.lat) for p in req.polygon]
        if len(coords) < 2:
            # degenerate, ignore
            return

        self.path = coords
        self._precompute_path()

        # initialise drones evenly along the path
        n = max(1, req.num_active)
        drones: List[Drone] = []
        for i in range(n):
            drones.append(
                Drone(
                    id=f"drone-{i}",
                    side="friendly" if i % 2 == 0 else "enemy",
                    path_param=i / n,
                    battery=1.0,
                    mode="PATROL",
                )
            )
        self.drones = drones

    def _precompute_path(self) -> None:
        segs: List[float] = []
        total = 0.0
        n = len(self.path)
        for i in range(n):
            x0, y0 = self.path[i]
            x1, y1 = self.path[(i + 1) % n]
            dx = x1 - x0
            dy = y1 - y0
            length = math.sqrt(dx * dx + dy * dy)
            segs.append(length)
            total += length
        self.seg_lengths = segs
        self.total_length = total

    def _point_at_fraction(self, f: float) -> Tuple[float, float] | None:
        if not self.path or not self.seg_lengths or self.total_length <= 0:
            return None

        # wrap to [0,1)
        frac = (f % 1.0 + 1.0) % 1.0
        distance = frac * self.total_length
        n = len(self.path)

        for i in range(n):
            seg_len = self.seg_lengths[i]
            if distance <= seg_len:
                t = 0.0 if seg_len == 0 else distance / seg_len
                x0, y0 = self.path[i]
                x1, y1 = self.path[(i + 1) % n]
                lng = x0 + (x1 - x0) * t
                lat = y0 + (y1 - y0) * t
                return (lng, lat)
            distance -= seg_len

        # fallback
        return self.path[-1]

    # ---- simulation step ----------------------------------------------

    def step(self, dt: float | None = None) -> None:
        """Advance simulation by dt seconds (or since last call if dt is None)."""
        if dt is None:
            now = time.time()
            dt = now - self.last_step_walltime
            self.last_step_walltime = now

        if dt <= 0:
            return
        if not self.path or self.total_length <= 0:
            return
        if not self.drones:
            return

        n = len(self.drones)
        drones = self.drones
        new_drones: List[Drone] = [d for d in drones]  # shallow copy

        # sorted indices by path_param
        order = sorted(range(n), key=lambda i: drones[i].path_param)

        for rank in range(n):
            idx = order[rank]
            drone = drones[idx]
            path_param = drone.path_param
            battery = drone.battery
            mode = drone.mode

            # drain battery
            battery = max(0.0, battery - BATTERY_DRAIN_RATE * dt)

            if mode == "PATROL" and battery <= RETURN_THRESHOLD:
                mode = "RETURNING"

            if mode == "PATROL":
                left_idx = order[(rank - 1 + n) % n]
                right_idx = order[(rank + 1) % n]

                left = drones[left_idx]
                right = drones[right_idx]

                gap_left = (path_param - left.path_param + 1.0) % 1.0
                gap_right = (right.path_param - path_param + 1.0) % 1.0

                v = PATH_BASE_SPEED + SPACING_GAIN * (gap_right - gap_left)

                path_param = (path_param + v * dt + 1.0) % 1.0

            elif mode == "RETURNING":
                diff = (HOME_PARAM - path_param + 1.0) % 1.0
                direction = -1.0 if diff > 0.5 else 1.0
                v_return = PATH_BASE_SPEED * 1.5 * direction
                path_param = (path_param + v_return * dt + 1.0) % 1.0

                dist_to_home = min(
                    (path_param - HOME_PARAM + 1.0) % 1.0,
                    (HOME_PARAM - path_param + 1.0) % 1.0,
                )
                if dist_to_home < 0.01:
                    # instant "recharge"
                    mode = "PATROL"
                    battery = 1.0

            new_drones[idx] = Drone(
                id=drone.id,
                side=drone.side,
                path_param=path_param,
                battery=battery,
                mode=mode,
            )

        self.drones = new_drones

    # ---- expose as DTOs ----------------------------------------------

    def get_world_state(self) -> WorldStateResponse:
        drones_dto: List[DroneDTO] = []
        for d in self.drones:
            pos = self._point_at_fraction(d.path_param)
            if pos is None:
                # fallback to home base if path invalid
                lng = self.home_base.lng
                lat = self.home_base.lat
            else:
                lng, lat = pos

            drones_dto.append(
                DroneDTO(
                    id=d.id,
                    side=d.side,
                    path_param=d.path_param,
                    battery=d.battery,
                    mode=d.mode,
                    position=LngLat(lng=lng, lat=lat),
                )
            )

        home_dto = HomeBaseDTO(
            id=self.home_base.id,
            position=LngLat(lng=self.home_base.lng, lat=self.home_base.lat),
        )

        return WorldStateResponse(drones=drones_dto, home_base=home_dto)


# single global simulator instance
simulator = SwarmSimulator()