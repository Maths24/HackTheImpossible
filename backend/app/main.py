from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .models import PatrolAreaRequest, WorldStateResponse
from .simulator import simulator

app = FastAPI(title="HackTheImpossible Drone Backend")

# Allow your Vite dev server to talk to FastAPI
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


@app.post("/api/patrol/area", response_model=WorldStateResponse)
def set_patrol_area(body: PatrolAreaRequest) -> WorldStateResponse:
    """
    Called by frontend when operator draws/updates the patrol polygon.
    """
    simulator.set_patrol_area(body)
    # immediately return first world state
    simulator.step(dt=0.01)  # tiny step to place them nicely
    return simulator.get_world_state()


@app.get("/api/world-state", response_model=WorldStateResponse)
def get_world_state() -> WorldStateResponse:
    """
    Called by frontend ~every 300–500 ms to get updated drone positions.
    """
    simulator.step()  # dt = real time since last call
    return simulator.get_world_state()