# backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import time

from .models import PatrolAreaRequest, WorldStateResponse
from .simulator import simulator   # global Simulator instance

app = FastAPI(title="HackTheImpossible Drone Backend")

# Allow your Vite dev server to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health() -> dict:
    return {"status": "ok"}

@app.post("/api/patrol/area", response_model=WorldStateResponse)
def set_patrol_area(body: PatrolAreaRequest) -> WorldStateResponse:
    """
    Called by frontend when operator draws/updates the patrol polygon.
    - stores polygon + center
    - resets drones to base
    - schedules launches (handled inside simulator)
    """
    simulator.set_patrol_area(body)
    return simulator.get_world_state()


# ---- NEW: world-state endpoint that advances the simulation ----
_last_step_time = time.perf_counter()

@app.get("/api/world-state", response_model=WorldStateResponse)
def get_world_state() -> WorldStateResponse:
    """
    Called regularly by the frontend (polling).
    Each call advances the simulation by the real time since the last call.
    """
    global _last_step_time
    now = time.perf_counter()
    dt = now - _last_step_time
    _last_step_time = now

    simulator.step(dt)
    return simulator.get_world_state()