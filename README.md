# SDC State Logic Builder

A visual state logic diagram builder for SDC (Steven Douglas Corp) that converts mechanical engineering state machine designs into Allen-Bradley Logix 5000 (L5X) PLC code.

## Overview

The SDC State Logic Builder lets engineers design state machines visually using a drag-and-drop canvas, configure devices and their behaviors, then export the result as structured L5X output ready for PLC integration. Projects are saved as JSON files and can be shared across the team.

## Features

- **Visual canvas** — drag-and-drop state machine editor built on React Flow
- **Device library** — sidebar with pre-built device types (servo axes, pneumatic grippers, etc.)
- **State & decision nodes** — build sequential and conditional logic flows
- **Device properties** — configure positions, timers, sensor arrangements per device
- **Recipe management** — manage recipe-driven position parameters
- **Project manager** — save, load, and delete projects stored on the network share
- **L5X export** — generate Logix 5000-compatible output from the diagram
- **Electron desktop app** or **browser-based** deployment via local server

## Tech Stack

| Layer | Technology |
|---|---|
| UI framework | React 18 + Vite |
| Diagram canvas | @xyflow/react (React Flow v12) |
| State management | Zustand |
| Desktop shell | Electron |
| Backend server | Node.js (no external dependencies) |

## Project Structure

```
State Logic Diagrams/
├── src/
│   ├── App.jsx                   # Root component, view routing
│   ├── components/
│   │   ├── Canvas.jsx            # React Flow canvas
│   │   ├── DeviceSidebar.jsx     # Draggable device palette
│   │   ├── Toolbar.jsx           # Top toolbar (save, export, etc.)
│   │   ├── PropertiesPanel.jsx   # Right-side node/device editor
│   │   ├── HomePage.jsx          # Landing page
│   │   ├── nodes/
│   │   │   ├── StateNode.jsx     # State step node
│   │   │   └── DecisionNode.jsx  # Conditional branch node
│   │   └── modals/
│   │       ├── NewStateMachineModal.jsx
│   │       ├── AddDeviceModal.jsx
│   │       ├── ActionModal.jsx
│   │       ├── ProjectManagerModal.jsx
│   │       ├── RecipeManagerModal.jsx
│   │       ├── SignalModal.jsx
│   │       └── SmOutputModal.jsx
│   ├── store/
│   │   └── useDiagramStore.js    # Global Zustand store
│   └── lib/                      # Utilities and export logic
├── server.js                     # Project file API server (port 3131)
├── electron/                     # Electron main process
├── App Files/                    # Saved project JSON files
├── dist/                         # Production build output
├── release/                      # Electron portable .exe output
├── START_APP.bat                 # Launch script
├── KEEP_RUNNING.bat              # Keep server running in background
└── INSTALL_AUTOSTART.bat         # Install server as autostart
```

## Getting Started

### Development

```bash
npm install
npm run dev        # Start Vite dev server
node server.js     # Start project file server (separate terminal)
```

### Production (Browser)

```bash
npm run build      # Build to dist/
npm run serve      # Serve via server.js on port 3131
```

Or use the provided batch files:
- **START_APP.bat** — builds and starts the server
- **KEEP_RUNNING.bat** — keeps the server alive
- **INSTALL_AUTOSTART.bat** — configures server to start with Windows

### Desktop (Electron)

```bash
npm run electron:build   # Produces release/SDC-State-Logic-Builder.exe
```

Run the portable `.exe` directly — no installation needed.

## Project File Server

`server.js` exposes a simple REST API for project persistence:

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/projects` | List all saved projects |
| GET | `/api/projects/:filename` | Load a project |
| POST | `/api/projects/:filename` | Save / overwrite a project |
| DELETE | `/api/projects/:filename` | Delete a project |

**Default storage:** `N:\10000_State_Logic_Diagram`
Override with the `DATA_DIR` environment variable.

**Default port:** `3131`
Override with the `PORT` environment variable.

## Project File Format

Projects are saved as `.json` files. Each file contains one or more **state machines**, each with:

- **Devices** — servo axes, pneumatic grippers, cylinders, etc.
  - Named positions with default values and recipe flags
  - Timer settings (extend, retract, engage, disengage, etc.)
- **States** — sequential steps with device actions
- **Decisions** — conditional branches based on sensor/signal inputs
- **Transitions** — edges connecting states and decisions

Example device types: `ServoAxis`, `PneumaticGripper`

## Supported Device Types

| Type | Description |
|---|---|
| ServoAxis | Servo motor with named target positions |
| PneumaticGripper | Pneumatic gripper with engage/disengage control |
| (others) | Configurable via Add Device modal |
