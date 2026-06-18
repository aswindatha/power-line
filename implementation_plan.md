# Implementation Plan - PowerGuard Monitor System

This plan outlines the implementation of the PowerGuard Monitor system, consisting of:
1. **MicroPython Firmware (ESP32-C3)**: Reads tension from HX711 and sends serial telemetry.
2. **Backend Server (Flask on Laptop)**: Reads serial data, tracks status, stores configuration, prints a terminal QR code, and serves the frontend.
3. **Mobile App (React/Vite)**: A premium, mobile-first Web App mirroring the mockups in `stitch_powerguard_monitor_dashboard`, featuring dynamic views (Splash, Dashboard, QR Scanner, Settings, Alert Overlay) with audio-visual alerts and offline-ready local storage.

---

## Proposed Architecture

```mermaid
graph TD
    subgraph ESP32-C3 [Hardware Layer]
        LC[Load Cell] --> HX[HX711 Amp]
        HX --> MP[MicroPython Edge Logic]
    end

    subgraph Laptop [Backend Layer]
        MP -- Serial -- COM --> PY[Flask Python Server]
        PY -- Generates -- QR[ASCII QR Code in CLI]
    end

    subgraph Mobile [Frontend Layer]
        QR -- Scanned By -- MS[React QR Scanner]
        MS -- Configures -- RX[React Live Telemetry]
        PY -- Serves Static React App / API -- RX
        RX -- Alerts / Maps -- Tech[Technician Phone]
    end
```

---

## Proposed Changes

### 1. Hardware Firmware (ESP32-C3)
We will update the ESP32 code to perform basic calibration, tension calculation, and edge status logic.

#### [MODIFY] [main.py](file:///c:/Users/aswin/Music/power-line/hw/main.py)
- Calibrate the HX711 readings to represent tension (in Newtons or kN).
- Implement edge check: if weight is below a threshold (e.g. near 0), mark status as `CUT`. Otherwise, `SAFE`.
- Output format on serial: `Weight: <val> Status: <status>` (e.g., `Weight: 35.2 Status: SAFE`).

---

### 2. Backend Laptop Server (Flask)
We will rewrite `server.py` to compile everything into a single-file backend that runs on the laptop.

#### [MODIFY] [server.py](file:///c:/Users/aswin/Music/power-line/server.py)
- **Serial Parsing**: Parse both weight and edge status from ESP32 serial data.
- **Data Model**: Store current tension, baseline, status (`SAFE`, `WARNING`, `ALERT`), station name, and Google Maps URL.
- **Configurable Settings**:
  - `POST /api/settings`: Updates station name and maps link.
  - `POST /api/start` & `POST /api/stop`: Controls active monitoring.
- **QR Code Generation**: Use the `qrcode` library to generate and print a QR code containing `http://<laptop_ip>:5000` to the terminal on startup. If the library is missing, auto-install it or display instructions.
- **Vite Build Serving**: Add static file routing to serve the compiled React app build from `mobile_app/dist` at the root `/` URL. This lets any phone on the network access the mobile app by visiting `http://<laptop_ip>:5000`.

---

### 3. Mobile App (Vite React + Tailwind CSS)
We will create a Vite React app in a new subfolder `mobile_app`. It will adopt the high-fidelity UI designs from `stitch_powerguard_monitor_dashboard`.

#### [NEW] [mobile_app/src/App.jsx](file:///c:/Users/aswin/Music/power-line/mobile_app/src/App.jsx)
We will compile the views into a single React application with a view router:
- **Splash Screen**:
  - WebGL electric shader background (adapted from `splash_screen/code.html`).
  - Rotating transmission tower SVG logo.
  - Loading progress bar simulating telemetry initialization before showing the Dashboard.
- **Home Dashboard**:
  - Live tension display (e.g., `847 N`).
  - Pulsing link status indicator (`Connected` / `Disconnected` / `Connecting`).
  - Live chart (mini sparkline) graphing historical tension.
  - Interactive Google Maps button opening the saved maps link.
- **QR Scanner**:
  - Activates mobile camera via `html5-qrcode` to scan the laptop QR code.
  - Extracts the backend URL and stores it in `localStorage` for automatic connection.
- **Settings Screen**:
  - Fields for station name and maps URL.
  - Button to scan QR.
  - Toggles for Sound, Vibration, and Auto Open Alerts.
- **Alert Overlay**:
  - Triggered automatically if `status === 'ALERT'`.
  - Full-screen warning stripes and siren icon.
  - Flashing red border + alarm sound + phone haptic vibration (using `navigator.vibrate`).
  - Displays last tension value, timestamp of cut, and "View Location" button.

---

## Verification Plan

### Automated Verification
- Verify Flask API endpoints using standard Python unit testing or manual curl requests.
- Verify serial fallback simulation works correctly if no ESP32 is plugged in.
- Lint and compile the React application.

### Manual Verification
1. **Laptop startup**: Run `python server.py`. Validate that a QR code prints to the terminal and that the server binds to `0.0.0.0:5000`.
2. **Mobile connection**: Scan the terminal QR code with a phone in the same network. Open the link in a mobile browser.
3. **Dashboard display**: Confirm live tension values update in real-time.
4. **Trigger alert (Simulated or Real)**: Decrease tension (or trigger simulation drop). Confirm the mobile app automatically vibrates, plays the siren sound, and displays the fullscreen warning screen.
5. **Open Maps**: Press "View Location" on the alert screen. Verify it redirects to Google Maps with the correct substation location coordinates.
6. **Save Settings**: Update the station name and maps URL on the settings page and verify they persist on the backend.
