from __future__ import annotations

from pydantic import BaseModel
from typing import List, Literal


class LngLat(BaseModel):
    lng: float
    lat: float


class DroneDTO(BaseModel):
    id: str
    position: LngLat
    side: Literal["friendly", "enemy"]
    path_param: float
    battery: float
    mode: Literal["PATROL", "RETURNING"]
    # you can add fields like offset later if needed


class HomeBaseDTO(BaseModel):
    id: str
    position: LngLat


class WorldStateResponse(BaseModel):
    drones: List[DroneDTO]
    home_base: HomeBaseDTO


class PatrolAreaRequest(BaseModel):
    polygon: List[LngLat]   # polygon ring (without duplicate last point)
    num_active: int         # how many drones we want patrolling