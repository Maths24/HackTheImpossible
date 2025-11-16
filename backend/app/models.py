# app/core/models.py
from __future__ import annotations

from typing import List, Literal
from pydantic import BaseModel


class LngLat(BaseModel):
    lng: float
    lat: float


# All possible modes your simulator uses
DroneMode = Literal[
    "PATROL",
    "RETURNING",
    "IDLE_AT_BASE",
    "TRANSIT_TO_AREA",
    "CHARGING",
    "LOST",
]


class DroneDTO(BaseModel):
    id: str
    position: LngLat
    side: Literal["friendly", "enemy"]
    path_param: float
    battery: float
    mode: DroneMode

    # <-- NEW: needed by simulator for phase progress in different states
    phase_progress: float = 0.0


class HomeBaseDTO(BaseModel):
    id: str
    position: LngLat


class EventDTO(BaseModel):
    """
    Event emitted by simulator for UI:
    - SUSPICIOUS: suspicious activity detected
    - LOST: drone lost / last known position
    """
    id: str
    drone_id: str
    type: Literal["SUSPICIOUS", "LOST", "RECHARGING"]
    position: LngLat
    message: str
    timestamp: float


class WorldStateResponse(BaseModel):
    drones: List[DroneDTO]
    home_base: HomeBaseDTO

    # <-- NEW: events for the frontend (map alerts + event stream)
    events: List[EventDTO] = []


class PatrolAreaRequest(BaseModel):
    polygon: List[LngLat]   # polygon ring (without duplicate last point)
    num_active: int         # how many drones we want patrolling