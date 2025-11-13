# HackTheImpossible – Frontend

This is the **React + TypeScript + Mapbox** frontend for the HackTheImpossible project. It provides an interactive command-and-control UI for drone swarms, featuring: - Realtime drone movement simulation - Patrol paths drawn directly on the map - Layer-based rendering engine - Status HUD overlay - Drone information panel

---

## 🚀 Getting Started

### 1. Install dependencies

From the **frontend** directory:

cd frontend
npm install

---

## 🔑 Mapbox Access Token

The app requires a Mapbox token (just ask me).

Create a file named **`.env.local`** inside `/frontend`:

VITE_MAPBOX_ACCESS_TOKEN=pk.your_mapbox_token_here

> The variable name **must** start with `VITE_` because Vite only exposes variables with that prefix.

---

## ▶️ Running the Development Server

Start the React dev server:

npm run dev

Then open the printed URL, normally:

http://localhost:5173


---

## 🗺️ Features

### Map & Simulation

- Mapbox GL JS map rendering
- Mapbox Draw polygon editor
- Drones patrol polygon boundaries
- Smooth movement via animation loop
- Layer-based rendering engine for flexible future expansion

### UI / UX

- Fixed status bar (operator position, demo mode, live clock)
- Click on any drone → info popup
- Clean separation of UI logic, map logic, and engine logic

