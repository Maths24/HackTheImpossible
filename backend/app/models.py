from __future__ import annotations

from pydantic import BaseModel
from typing import List, Literal


class LngLat(BaseModel):
    lng: float
    lat: float


# All the modes we now need in the sim
DroneMode = Literal[
    "IDLE_AT_BASE",     # sitting at base, ready to launch
    "TRANSIT_TO_AREA",  # flying from base to patrol area
    "PATROL",           # actively patrolling in the area
    "RETURNING",        # flying back to base
    "CHARGING",         # on the ground, charging
]


class DroneDTO(BaseModel):
    id: str
    position: LngLat
    side: Literal["friendly", "enemy"]

    # 1D-coordinate along whatever path/corridor you use (0..1)
    path_param: float

    # battery 0..1
    battery: float

    # lifecycle / behaviour state
    mode: DroneMode

    # progress 0..1 of current phase (e.g. base → area, area → base)
    phase_progress: float = 0.0


class HomeBaseDTO(BaseModel):
    id: str
    position: LngLat
    # optional, but often useful
    range_km: float | None = None


class WorldStateResponse(BaseModel):
    drones: List[DroneDTO]
    home_base: HomeBaseDTO
    # optional: current sim time, etc.
    # sim_time: float | None = None


class PatrolAreaRequest(BaseModel):
    # polygon ring (without duplicate last point), same as before
    polygon: List[LngLat]

    # how many drones we want patrolling in the area
    num_active: int