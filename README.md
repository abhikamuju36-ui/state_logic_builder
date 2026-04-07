# SDC State Logic Builder

A React web app for building Allen Bradley PLC state machine diagrams and exporting them to L5X code.

## What It Does

- Draw state machine flowcharts visually on a drag-and-drop canvas
- Configure devices (cylinders, grippers, servos, sensors, robots, vision systems, conveyors, feeders, printers, etc.)
- Define state transitions with sensor conditions
- Export to Allen Bradley L5X PLC code following SDC coding standards

## Quick Start (Development)

```bash
# Install dependencies (first time only)
npm install

# Start the dev server
npm run dev
# App runs at http://localhost:5173
```

Or double-click **`START_APP.bat`** — it installs dependencies and starts the dev server automatically.

## Team Server (Shared Projects)

Run **`BUILD_AND_RUN.bat`** to build the app and start a local server on port 3131.
Any computer on the network can connect at `http://<your-ip>:3131`.
Projects are saved in `data\projects\` — back this folder up regularly.

## Saving Your Work

- **Save button** (toolbar) — downloads the project as a `.json` file to your computer
- **Open button** — loads a previously saved `.json` file
- Projects in the browser are also persisted in `localStorage` automatically between sessions

## Building the Desktop App

Run **`BUILD_DESKTOP.bat`** to package the app as a portable `.exe` (requires Electron builder).
Output goes to `release\SDC-State-Logic-Builder.exe`.

## Tech Stack

- React 18 + Vite
- @xyflow/react (React Flow v12) for the canvas
- Zustand for state management
- Node.js (`server.js`) for optional local project persistence API

## Project File Server

`server.js` exposes a simple REST API on port 3131 for project file persistence:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all saved projects |
| GET | `/api/projects/:filename` | Load a project |
| POST | `/api/projects/:filename` | Save a project |
| DELETE | `/api/projects/:filename` | Delete a project |

Override the port with the `PORT` environment variable.

## Device Types Supported

| Device | Notes |
|--------|-------|
| Pneumatic Linear Actuator | Extend/Retract solenoids + sensors + delay timers |
| Pneumatic Rotary Actuator | Extend/Retract solenoids + sensors + delay timers |
| Pneumatic Gripper | Engage/Disengage solenoids + sensors |
| Pneumatic Vac Generator | Vacuum on/off + sensor |
| Servo Axis | MAM motion instructions per named position |
| Digital Sensor | Input bit |
| Analog Sensor | Scaled value + setpoint in-range checks |
| Vision System | Trigger + result + inspect pass signals |
| Robot | Ready/CycComplete/AtHome + configurable DI/DO signals |
| Conveyor | Run output |
| Friction Feeder | FeedComplete/Ready/Jam inputs |
| Label Printer | Ready/Complete/Fault inputs |
| Parameter | BOOL (`q_`) or REAL (`p_`) parameter tags |
