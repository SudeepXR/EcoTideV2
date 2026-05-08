# 🌊 EcoTide — Autonomous Aquatic Monitoring & Remediation

EcoTide is an end-to-end autonomous water quality monitoring and remediation system designed to survey lakes and ponds. It integrates self-navigation, real-time environmental sensing, and AI-driven analysis into a unified industrial dashboard.

---

## 🚀 Core Features

### 🗺️ Autonomous Mission Planning
- **Interactive Mapping**: Draw survey boundaries directly on a Leaflet-powered map.
- **Lawnmower Path Generation**: Automatic generation of optimized zig-zag coverage paths based on user-defined spacing.
- **One-Click Dispatch**: Transmit waypoints wirelessly to the boat's navigation system.

### 📊 Real-Time Telemetry & Monitoring
- **Live Sensor Streams**: Monitor Temperature, pH, Turbidity (NTU), TDS (ppm), and Ammonia (NH3) levels.
- **WQI Analysis**: Automatic calculation of a Water Quality Index (WQI) for at-a-glance health assessment.
- **Visual Trends**: High-density charts showing parameter behavior over time.
- **Industrial Interface**: Technical, high-contrast dashboard with "Mission Control" aesthetics and light/dark mode support.

### 🤖 AI Integration
- **AI Mission Reports**: Groq-powered (Llama 3.3) natural language analysis of survey data, providing trends and remediation recommendations.
- **Repeat Mission (Return Path)**: Reverse the boat's survey path automatically for methodical remediation liquid dispensing.

### 🕹️ Manual Control
- **Remote Steering**: Take manual control at any time using a mobile-responsive D-pad.
- **Dual-Mode Safety**: Toggle between Autonomous and Manual modes with instant motor cut-offs.

---

## 🛠️ Technical Implementation

### System Architecture
EcoTide uses a dual-backend architecture to separate navigation logic from data telemetry:
1. **Navigation Backend (Flask - Port 5000)**: Handles coordinate conversion (Lat/Lon to Meters), path generation (Shapely/NumPy), and ESP32 waypoint proxying.
2. **Telemetry Backend (FastAPI - Port 8000)**: Manages sensor data storage (SQLite), real-time polling, and PDF report generation (FPDF).

### Hardware Stack
- **ESP32 (Navigation)**: Main processor for autonomous missions. Uses GPS (TinyGPS++) and Magnetometer (Compass) for waypoint following.
- **ESP8266 (Motor Control)**: Dedicated bridge for manual steering commands and motor PWM signals.
- **Sensor Array**: Integrated sensors for pH, TDS, Turbidity, and Temperature.

### Frontend Technologies
- **Mapping**: Leaflet.js with Leaflet.Draw for mission boundaries.
- **Charts**: Chart.js for real-time telemetry visualization.
- **Styling**: Vanilla CSS with a technical "Industrial" theme and dynamic light/dark mode switching.
- **AI**: Groq API integration using the `llama-3.3-70b-versatile` model.

---

## 📂 Folder Structure

```text
EcoTideV2/
├── app.py                # Flask Backend (Navigation, Path Gen, ESP Proxy)
├── index.html            # Unified Frontend Interface
├── requirements.txt      # Python Dependencies
├── static/               # Core Frontend Assets
│   ├── ecotide.js        # Main logic (View switching, AI, Transmissions)
│   ├── ecotide.css       # Industrial design system
│   └── script.js         # Map & Path generation logic
├── templates/            # Flask Templates
├── esp32/                # Microcontroller Firmware
│   ├── boat_nav.ino      # ESP32 Autonomous Navigation code
│   └── esp8266_motor_control.ino # ESP8266 Manual/Motor logic
└── EcoTideV2-main/       # Telemetry Backend (AquaSense Core)
    ├── server.py         # FastAPI Backend (Sensor API, PDF Gen, DB)
    └── sensor_data.db    # SQLite Database for history
```

---

## 🔧 Setup & Installation

1. **Python Environment**:
   ```bash
   pip install -r requirements.txt
   ```
2. **Run Navigation Backend**:
   ```bash
   python app.py
   ```
3. **Run Telemetry Backend**:
   ```bash
   cd EcoTideV2-main
   uvicorn server:app --reload --port 8000
   ```
4. **Configuration**:
   - Update `ESP32_IP` in `app.py` and `ESP8266_BASE` in `ecotide.js`.
   - Add your `GROQ_API_KEY` to `ecotide.js` for AI reporting.

---

## ⚠️ Notes & Missing Items

- **Hardware Integration**: Ensure the ESP32 and ESP8266 are on the same local network as the server.
- **Manual Mode Toggle**: Ensure the physical boat has a safety hardware switch for manual override.
