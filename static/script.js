// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  drawnPolygon: null,   // Leaflet layer
  pathPolyline: null,   // Leaflet polyline
  waypointLayer: null,  // Leaflet layer group
  polygonCoords: [],    // [[lat,lon], ...]
  lastPath: [],         // last generated path coordinates
};

// ─── Map Initialisation ───────────────────────────────────────────────────────
const map = L.map("map", {
  center: [20.5937, 78.9629], // India center – change as needed
  zoom: 5,
  zoomControl: true,
});

// Tile layer – CartoDB Voyager (full color, modern)
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 20,
}).addTo(map);

// ─── Leaflet.draw Setup ───────────────────────────────────────────────────────
const drawnItems = new L.FeatureGroup().addTo(map);

const drawControl = new L.Control.Draw({
  position: "topleft",
  draw: {
    polygon: {
      allowIntersection: false,
      showArea: true,
      shapeOptions: {
        color: "#58a6ff",
        fillColor: "#58a6ff",
        fillOpacity: 0.12,
        weight: 2,
        dashArray: "6 4",
      },
    },
    polyline: false,
    rectangle: false,
    circle: false,
    circlemarker: false,
    marker: false,
  },
  edit: {
    featureGroup: drawnItems,
    remove: true,
  },
});
map.addControl(drawControl);

// ─── Draw Events ──────────────────────────────────────────────────────────────
map.on(L.Draw.Event.CREATED, (e) => {
  // Remove any previously drawn polygon
  drawnItems.clearLayers();
  clearPath();
  state.lastPath = [];
  hideExportButtons();

  const layer = e.layer;
  drawnItems.addLayer(layer);
  state.drawnPolygon = layer;

  // Extract lat/lon pairs from the drawn shape
  const latlngs = layer.getLatLngs()[0]; // outer ring
  state.polygonCoords = latlngs.map((ll) => [ll.lat, ll.lng]);

  setStep(2);
  setStatus("Polygon ready. Adjust spacing and click Generate.", "");
  updateGenerateButton();
});

map.on(L.Draw.Event.DELETED, () => {
  state.drawnPolygon = null;
  state.polygonCoords = [];
  clearPath();
  state.lastPath = [];
  hideExportButtons();
  setStep(1);
  setStatus("Draw a polygon on the map to begin.", "");
  updateGenerateButton();
  resetStats();
});

map.on(L.Draw.Event.EDITED, () => {
  // Re-read coordinates after editing
  if (state.drawnPolygon) {
    const latlngs = state.drawnPolygon.getLatLngs()[0];
    state.polygonCoords = latlngs.map((ll) => [ll.lat, ll.lng]);
  }
  clearPath();
  setStatus("Polygon edited. Click Generate to update the path.", "");
  updateGenerateButton();
});

// ─── Slider ───────────────────────────────────────────────────────────────────
const slider = document.getElementById("spacing-slider");
const sliderVal = document.getElementById("spacing-value");

function updateSliderTrack() {
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const val = parseFloat(slider.value);
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.setProperty("--pct", `${pct}%`);
  sliderVal.textContent = `${val} m`;
}

slider.addEventListener("input", () => {
  updateSliderTrack();
});

updateSliderTrack();

// ─── Generate Button ──────────────────────────────────────────────────────────
const generateBtn = document.getElementById("generate-btn");
const clearBtn = document.getElementById("clear-btn");

generateBtn.addEventListener("click", generatePath);
clearBtn.addEventListener("click", () => {
  drawnItems.clearLayers();
  clearPath();
  state.lastPath = [];
  hideExportButtons();
  state.drawnPolygon = null;
  state.polygonCoords = [];
  setStep(1);
  setStatus("Draw a polygon on the map to begin.", "");
  updateGenerateButton();
  resetStats();
});

function updateGenerateButton() {
  generateBtn.disabled = state.polygonCoords.length < 3;
}

// ─── Core: Generate Path ──────────────────────────────────────────────────────
async function generatePath() {
  if (state.polygonCoords.length < 3) {
    setStatus("Please draw a polygon first.", "error");
    return;
  }

  const spacing = parseFloat(slider.value);

  setStatus("Generating coverage path…", "loading");
  generateBtn.disabled = true;

  // Show spinner inside button
  generateBtn.innerHTML = `<span class="spinner"></span> Generating…`;

  try {
    const response = await fetch("/generate-path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ polygon: state.polygonCoords, spacing }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `Server error ${response.status}`);
    }

    const data = await response.json();
    const path = data.path;

    if (!path || path.length === 0) {
      throw new Error("No path returned. Try a larger spacing or bigger polygon.");
    }

    state.lastPath = path;
    displayPath(path);
    setStep(3);
    setStatus(`✓ Path generated — ${path.length} waypoints`, "success");
    updateStats(path, spacing);
    showExportButtons();
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
  } finally {
    generateBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg> Generate Coverage Path`;
    updateGenerateButton();
  }
}

// ─── Display Path ─────────────────────────────────────────────────────────────
function displayPath(path) {
  clearPath();

  const latlngs = path.map(([lat, lon]) => [lat, lon]);

  // Polyline
  state.pathPolyline = L.polyline(latlngs, {
    color: "#58a6ff",
    weight: 2.5,
    opacity: 0.9,
    lineJoin: "round",
  }).addTo(map);

  // Waypoint circles
  state.waypointLayer = L.layerGroup();

  // Only show waypoints if there are a reasonable number
  if (path.length <= 300) {
    path.forEach(([lat, lon], i) => {
      const circle = L.circleMarker([lat, lon], {
        radius: 3,
        color: "#79bcff",
        fillColor: "#1f6feb",
        fillOpacity: 0.9,
        weight: 1,
      });
      circle.bindTooltip(`Waypoint ${i + 1}<br>(${lat.toFixed(5)}, ${lon.toFixed(5)})`, {
        direction: "top",
        className: "wp-tooltip",
      });
      state.waypointLayer.addLayer(circle);
    });
  }

  state.waypointLayer.addTo(map);

  // Fit map to show full path
  const bounds = state.pathPolyline.getBounds();
  map.fitBounds(bounds, { padding: [40, 40] });
}

function clearPath() {
  if (state.pathPolyline) { map.removeLayer(state.pathPolyline); state.pathPolyline = null; }
  if (state.waypointLayer) { map.removeLayer(state.waypointLayer); state.waypointLayer = null; }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function updateStats(path, spacing) {
  // Approximate total path length in metres
  let totalLen = 0;
  for (let i = 1; i < path.length; i++) {
    totalLen += haversineMeters(path[i - 1], path[i]);
  }

  document.getElementById("stat-waypoints").textContent = path.length;
  document.getElementById("stat-length").textContent =
    totalLen >= 1000 ? `${(totalLen / 1000).toFixed(2)} km` : `${Math.round(totalLen)} m`;
  document.getElementById("stat-spacing").textContent = `${spacing} m`;
  document.getElementById("stat-lines").textContent = Math.floor(path.length / 2);
}

function resetStats() {
  ["stat-waypoints", "stat-length", "stat-spacing", "stat-lines"].forEach((id) => {
    document.getElementById(id).textContent = "—";
  });
}

// ─── Haversine (client-side distance) ────────────────────────────────────────
function haversineMeters([lat1, lon1], [lat2, lon2]) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Export: Download / Copy ─────────────────────────────────────────────────
document.getElementById("download-btn").addEventListener("click", downloadPath);
document.getElementById("copy-btn").addEventListener("click", copyCoords);

function showExportButtons() {
  document.getElementById("export-section").style.display = "block";
  document.getElementById("esp-section").style.display = "block";
}

function hideExportButtons() {
  document.getElementById("export-section").style.display = "none";
  document.getElementById("esp-section").style.display = "none";
}

function downloadPath() {
  if (!state.lastPath.length) return;
  const payload = {
    generated_at: new Date().toISOString(),
    waypoint_count: state.lastPath.length,
    spacing_m: parseFloat(slider.value),
    path: state.lastPath.map(([lat, lon], i) => ({ index: i, lat, lon })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `coverage_path_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyCoords() {
  if (!state.lastPath.length) return;
  const text = state.lastPath.map(([lat, lon]) => `${lat.toFixed(7)}, ${lon.toFixed(7)}`).join("\n");
  await navigator.clipboard.writeText(text);
  const btn = document.getElementById("copy-btn");
  const orig = btn.innerHTML;
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
  btn.style.borderColor = "var(--success)";
  btn.style.color = "var(--success)";
  setTimeout(() => {
    btn.innerHTML = orig;
    btn.style.borderColor = "";
    btn.style.color = "";
  }, 2000);
}

// ─── Step indicator ───────────────────────────────────────────────────────────
function setStep(active) {
  document.querySelectorAll(".step").forEach((el, i) => {
    el.classList.remove("active", "done");
    const n = i + 1;
    if (n < active) el.classList.add("done");
    else if (n === active) el.classList.add("active");
  });
}

// ─── Status bar ───────────────────────────────────────────────────────────────
function setStatus(msg, type) {
  const bar = document.getElementById("status-bar");
  bar.textContent = msg;
  bar.className = "";
  if (type) bar.classList.add(type);
}

// ─── Location Search ────────────────────────────────────────────────────────
const locationSearchInput = document.getElementById("location-search-input");
const locationSearchBtn = document.getElementById("location-search-btn");

locationSearchBtn.addEventListener("click", searchLocation);
locationSearchInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") searchLocation();
});

async function searchLocation() {
  const query = locationSearchInput.value.trim();
  if (!query) return;

  locationSearchBtn.disabled = true;
  locationSearchBtn.innerHTML = '<span class="spinner" style="width:10px; height:10px;"></span>';

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
    const data = await response.json();
    
    if (data && data.length > 0) {
      const result = data[0];
      const lat = parseFloat(result.lat);
      const lon = parseFloat(result.lon);
      const boundingBox = result.boundingbox; // [latMin, latMax, lonMin, lonMax]
      
      if (boundingBox) {
        const bounds = [
          [parseFloat(boundingBox[0]), parseFloat(boundingBox[2])], // SouthWest
          [parseFloat(boundingBox[1]), parseFloat(boundingBox[3])]  // NorthEast
        ];
        map.fitBounds(bounds);
      } else {
        map.setView([lat, lon], 13);
      }
      setStatus(`Found: ${result.display_name.split(',')[0]}`, "success");
    } else {
      setStatus(`Location not found: ${query}`, "error");
    }
  } catch (err) {
    setStatus(`Search error: ${err.message}`, "error");
  } finally {
    locationSearchBtn.disabled = false;
    locationSearchBtn.textContent = "Search";
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
setStep(1);
updateGenerateButton();
resetStats();

// ─── ESP32: Send to Boat ────────────────────────────────────────────────────
const sendBoatBtn = document.getElementById("send-to-boat-btn");
const espPingBtn = document.getElementById("esp-ping-btn");
const espIpInput = document.getElementById("esp-ip-input");
const espStatusDot = document.getElementById("esp-status-dot");
const espResult = document.getElementById("esp-result");

sendBoatBtn.addEventListener("click", sendToBoat);
espPingBtn.addEventListener("click", pingEsp);

// Update backend ESP32 IP when user changes the input
espIpInput.addEventListener("change", async () => {
  const ip = espIpInput.value.trim();
  if (!ip) return;
  try {
    await fetch("/update-esp-ip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip }),
    });
  } catch (e) {
    // silently ignore
  }
});

async function sendToBoat() {
  if (!state.lastPath.length) {
    showEspResult("No waypoints generated yet.", false);
    return;
  }

  sendBoatBtn.disabled = true;
  sendBoatBtn.innerHTML = '<span class="spinner"></span> Sending…';
  showEspResult("", false);

  // Build waypoints array matching ESP32 JSON format
  const waypoints = state.lastPath.map(([lat, lon]) => ({ lat, lon }));

  try {
    const resp = await fetch("/send-to-esp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoints }),
    });

    const data = await resp.json();

    if (resp.ok && data.status === "ok") {
      showEspResult(`✓ ${data.message}`, true);
      setStep(4);
      setStatus(`✓ Waypoints sent to ESP32 boat`, "success");
    } else {
      showEspResult(`✗ ${data.error || "Unknown error"}`, false);
      setStatus(`ESP32 error: ${data.error || "Unknown"}`, "error");
    }
  } catch (err) {
    showEspResult(`✗ Network error: ${err.message}`, false);
    setStatus(`ESP32 connection failed`, "error");
  } finally {
    sendBoatBtn.disabled = false;
    sendBoatBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 20h20"/><path d="M3.5 15h17l-2-7H5.5L3.5 15z"/><path d="M12 4v4"/><path d="M9 4h6"/></svg> Send to Boat`;
  }
}

async function pingEsp() {
  espStatusDot.className = "control-value esp-status-dot";
  espStatusDot.title = "Checking…";
  espPingBtn.disabled = true;
  espPingBtn.textContent = "…";

  try {
    const resp = await fetch("/esp-status");
    const data = await resp.json();

    if (data.online) {
      espStatusDot.classList.add("online");
      espStatusDot.title = "ESP32 online";
      showEspResult(`✓ ESP32 online at ${data.ip}`, true);
    } else {
      espStatusDot.classList.add("offline");
      espStatusDot.title = "ESP32 offline";
      showEspResult(`✗ ESP32 offline at ${data.ip}`, false);
    }
  } catch (err) {
    espStatusDot.classList.add("offline");
    espStatusDot.title = "Cannot reach server";
    showEspResult(`✗ Server error`, false);
  } finally {
    espPingBtn.disabled = false;
    espPingBtn.textContent = "Ping";
  }
}

function showEspResult(msg, ok) {
  if (!msg) { espResult.style.display = "none"; return; }
  espResult.style.display = "block";
  espResult.textContent = msg;
  espResult.className = "esp-result " + (ok ? "result-ok" : "result-err");
}
