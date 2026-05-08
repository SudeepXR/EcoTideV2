/* ═══════════════════════════════════════════════════════════════════════════ */
/* ECOTIDE UNIFIED JAVASCRIPT                                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

const FLASK_BASE = "http://localhost:5000";
const FASTAPI_BASE = "http://localhost:8000";

// ── ESP8266 Manual Control IP ──────────────────────────────────────────────
// Update this after flashing ESP8266 and checking Serial Monitor
const ESP8266_BASE = "http://192.168.x.x";  // ← change this

// ── Groq AI Report Config ─────────────────────────────────────────────────
const GROQ_API_KEY = "API_KEY_HERE";
const GROQ_MODEL = "llama-3.3-70b-versatile";
let lastWaypoints = null;  // stores last sent waypoint array

// ── Theme Toggle Logic ──────────────────────────────────────────────────
function initTheme() {
  const theme = localStorage.getItem('theme') || 'dark';
  if (theme === 'light') {
    document.body.classList.add('light-mode');
    document.getElementById('theme-icon-light').style.display = 'none';
    document.getElementById('theme-icon-dark').style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    document.getElementById('theme-icon-light').style.display = isLight ? 'none' : 'block';
    document.getElementById('theme-icon-dark').style.display = isLight ? 'block' : 'none';
    
    // Update charts for the new theme
    if (typeof updateChartTheme === 'function') updateChartTheme();
    
    // Invalidate map size to prevent gray tiles on theme switch
    if (window._map) window._map.invalidateSize();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VIEW SWITCHING
// ═══════════════════════════════════════════════════════════════════════════
let monitorPollingId = null;
let monitorInitialized = false;

function showView(name) {
  document.getElementById('view-planner').style.display = name === 'planner' ? 'block' : 'none';
  document.getElementById('view-monitor').style.display = name === 'monitor' ? 'block' : 'none';
  document.getElementById('view-navigation').style.display = name === 'navigation' ? 'block' : 'none';
  document.getElementById('tab-planner').classList.toggle('active', name === 'planner');
  document.getElementById('tab-monitor').classList.toggle('active', name === 'monitor');
  document.getElementById('tab-navigation').classList.toggle('active', name === 'navigation');

  if (name === 'monitor') {
    if (!monitorInitialized) { initMonitor(); monitorInitialized = true; }
    startMonitorPolling();
  } else {
    stopMonitorPolling();
    // Invalidate map size after becoming visible again
    setTimeout(() => { if (window._map) window._map.invalidateSize(); }, 100);
  }

  if (name === 'navigation') {
    startNavPolling();
  } else {
    stopNavPolling();
  }
}

function startMonitorPolling() {
  if (monitorPollingId) return;
  updateDashboard();
  monitorPollingId = setInterval(updateDashboard, 2000);
}

function stopMonitorPolling() {
  if (monitorPollingId) { clearInterval(monitorPollingId); monitorPollingId = null; }
}

// Toast
function showToast(msg, type, duration) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show toast-' + (type || 'success');
  setTimeout(() => { t.className = 'toast'; }, duration || 3000);
}

// ═══════════════════════════════════════════════════════════════════════════
// PLANNER (Navigation Frontend) — from script.js
// ═══════════════════════════════════════════════════════════════════════════
const state = { drawnPolygon: null, pathPolyline: null, waypointLayer: null, polygonCoords: [], lastPath: [] };

const map = L.map("map", { center: [20.5937, 78.9629], zoom: 5, zoomControl: true });
window._map = map;

L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd", maxZoom: 20
}).addTo(map);

const drawnItems = new L.FeatureGroup().addTo(map);
const drawControl = new L.Control.Draw({
  position: "topleft",
  draw: { polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: "#58a6ff", fillColor: "#58a6ff", fillOpacity: 0.12, weight: 2, dashArray: "6 4" } }, polyline: false, rectangle: false, circle: false, circlemarker: false, marker: false },
  edit: { featureGroup: drawnItems, remove: true }
});
map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, (e) => {
  drawnItems.clearLayers(); clearPath(); state.lastPath = []; hideExportButtons();
  const layer = e.layer; drawnItems.addLayer(layer); state.drawnPolygon = layer;
  state.polygonCoords = layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
  setStep(2); setStatus("Polygon ready. Adjust spacing and click Generate.", ""); updateGenerateButton();
});
map.on(L.Draw.Event.DELETED, () => {
  state.drawnPolygon = null; state.polygonCoords = []; clearPath(); state.lastPath = []; hideExportButtons();
  setStep(1); setStatus("Draw a polygon on the map to begin.", ""); updateGenerateButton(); resetStats();
});
map.on(L.Draw.Event.EDITED, () => {
  if (state.drawnPolygon) { state.polygonCoords = state.drawnPolygon.getLatLngs()[0].map(ll => [ll.lat, ll.lng]); }
  clearPath(); setStatus("Polygon edited. Click Generate to update the path.", ""); updateGenerateButton();
});

const slider = document.getElementById("spacing-slider");
const sliderVal = document.getElementById("spacing-value");
function updateSliderTrack() {
  const pct = ((parseFloat(slider.value) - parseFloat(slider.min)) / (parseFloat(slider.max) - parseFloat(slider.min))) * 100;
  slider.style.setProperty("--pct", pct + "%"); sliderVal.textContent = slider.value + " m";
}
slider.addEventListener("input", updateSliderTrack);
updateSliderTrack();

const generateBtn = document.getElementById("generate-btn");
const clearBtn = document.getElementById("clear-btn");
generateBtn.addEventListener("click", generatePath);
clearBtn.addEventListener("click", () => {
  drawnItems.clearLayers(); clearPath(); state.lastPath = []; hideExportButtons();
  state.drawnPolygon = null; state.polygonCoords = [];
  setStep(1); setStatus("Draw a polygon on the map to begin.", ""); updateGenerateButton(); resetStats();
});
function updateGenerateButton() { generateBtn.disabled = state.polygonCoords.length < 3; }

async function generatePath() {
  if (state.polygonCoords.length < 3) { setStatus("Please draw a polygon first.", "error"); return; }
  const spacing = parseFloat(slider.value);
  setStatus("Generating coverage path…", "loading"); generateBtn.disabled = true;
  generateBtn.innerHTML = '<span class="spinner"></span> Generating…';
  try {
    const response = await fetch(FLASK_BASE + "/generate-path", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ polygon: state.polygonCoords, spacing }) });
    if (!response.ok) { const err = await response.json(); throw new Error(err.error || "Server error " + response.status); }
    const data = await response.json(); const path = data.path;
    if (!path || path.length === 0) throw new Error("No path returned. Try a larger spacing or bigger polygon.");
    state.lastPath = path; displayPath(path); setStep(3);
    setStatus("✓ Path generated — " + path.length + " waypoints", "success");
    updateStats(path, spacing); showExportButtons();
  } catch (err) { setStatus("Error: " + err.message, "error"); } finally {
    generateBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg> Generate Coverage Path';
    updateGenerateButton();
  }
}

function displayPath(path) {
  clearPath();
  const latlngs = path.map(([lat, lon]) => [lat, lon]);
  state.pathPolyline = L.polyline(latlngs, { color: "#58a6ff", weight: 2.5, opacity: 0.9, lineJoin: "round" }).addTo(map);
  state.waypointLayer = L.layerGroup();
  if (path.length <= 300) {
    path.forEach(([lat, lon], i) => {
      const c = L.circleMarker([lat, lon], { radius: 3, color: "#79bcff", fillColor: "#1f6feb", fillOpacity: 0.9, weight: 1 });
      c.bindTooltip("Waypoint " + (i+1) + "<br>(" + lat.toFixed(5) + ", " + lon.toFixed(5) + ")", { direction: "top" });
      state.waypointLayer.addLayer(c);
    });
  }
  state.waypointLayer.addTo(map);
  map.fitBounds(state.pathPolyline.getBounds(), { padding: [40, 40] });
}
function clearPath() {
  if (state.pathPolyline) { map.removeLayer(state.pathPolyline); state.pathPolyline = null; }
  if (state.waypointLayer) { map.removeLayer(state.waypointLayer); state.waypointLayer = null; }
}

function updateStats(path, spacing) {
  let totalLen = 0;
  for (let i = 1; i < path.length; i++) totalLen += haversineMeters(path[i-1], path[i]);
  document.getElementById("stat-waypoints").textContent = path.length;
  document.getElementById("stat-length").textContent = totalLen >= 1000 ? (totalLen/1000).toFixed(2)+" km" : Math.round(totalLen)+" m";
  document.getElementById("stat-spacing").textContent = spacing+" m";
  document.getElementById("stat-lines").textContent = Math.floor(path.length / 2);
}
function resetStats() { ["stat-waypoints","stat-length","stat-spacing","stat-lines"].forEach(id => { document.getElementById(id).textContent = "—"; }); }

function haversineMeters([lat1,lon1],[lat2,lon2]) {
  const R=6371000, dLat=((lat2-lat1)*Math.PI)/180, dLon=((lon2-lon1)*Math.PI)/180;
  const a=Math.sin(dLat/2)**2+Math.cos((lat1*Math.PI)/180)*Math.cos((lat2*Math.PI)/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

document.getElementById("download-btn").addEventListener("click", downloadPath);
document.getElementById("copy-btn").addEventListener("click", copyCoords);
function showExportButtons() { document.getElementById("export-section").style.display = "block"; document.getElementById("esp-section").style.display = "block"; }
function hideExportButtons() { document.getElementById("export-section").style.display = "none"; document.getElementById("esp-section").style.display = "none"; }

function downloadPath() {
  if (!state.lastPath.length) return;
  const payload = { generated_at: new Date().toISOString(), waypoint_count: state.lastPath.length, spacing_m: parseFloat(slider.value), path: state.lastPath.map(([lat,lon],i) => ({index:i,lat,lon})) };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "coverage_path_"+Date.now()+".json"; a.click(); URL.revokeObjectURL(url);
}
async function copyCoords() {
  if (!state.lastPath.length) return;
  const text = state.lastPath.map(([lat,lon]) => lat.toFixed(7)+", "+lon.toFixed(7)).join("\n");
  await navigator.clipboard.writeText(text);
  const btn = document.getElementById("copy-btn"); const orig = btn.innerHTML;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
  btn.style.borderColor = "var(--success)"; btn.style.color = "var(--success)";
  setTimeout(() => { btn.innerHTML = orig; btn.style.borderColor = ""; btn.style.color = ""; }, 2000);
}

function setStep(active) {
  document.querySelectorAll(".step").forEach((el, i) => { el.classList.remove("active","done"); const n=i+1; if(n<active) el.classList.add("done"); else if(n===active) el.classList.add("active"); });
}
function setStatus(msg, type) {
  const bar = document.getElementById("status-bar"); bar.textContent = msg; bar.className = ""; if (type) bar.classList.add(type);
}

// Location Search
const locationSearchInput = document.getElementById("location-search-input");
const locationSearchBtn = document.getElementById("location-search-btn");
locationSearchBtn.addEventListener("click", searchLocation);
locationSearchInput.addEventListener("keypress", (e) => { if (e.key === "Enter") searchLocation(); });
async function searchLocation() {
  const query = locationSearchInput.value.trim(); if (!query) return;
  locationSearchBtn.disabled = true; locationSearchBtn.innerHTML = '<span class="spinner" style="width:10px;height:10px;"></span>';
  try {
    const response = await fetch("https://nominatim.openstreetmap.org/search?format=json&q="+encodeURIComponent(query));
    const data = await response.json();
    if (data && data.length > 0) {
      const result = data[0]; const lat = parseFloat(result.lat); const lon = parseFloat(result.lon);
      const bb = result.boundingbox;
      if (bb) { map.fitBounds([[parseFloat(bb[0]),parseFloat(bb[2])],[parseFloat(bb[1]),parseFloat(bb[3])]]); } else { map.setView([lat,lon],13); }
      setStatus("Found: "+result.display_name.split(',')[0], "success");
    } else { setStatus("Location not found: "+query, "error"); }
  } catch(err) { setStatus("Search error: "+err.message, "error"); } finally { locationSearchBtn.disabled = false; locationSearchBtn.textContent = "Search"; }
}

setStep(1); updateGenerateButton(); resetStats();

// ESP32
const sendBoatBtn = document.getElementById("send-to-boat-btn");
const espPingBtn = document.getElementById("esp-ping-btn");
const espIpInput = document.getElementById("esp-ip-input");
const espStatusDot = document.getElementById("esp-status-dot");
const espResult = document.getElementById("esp-result");
sendBoatBtn.addEventListener("click", sendToBoat);
espPingBtn.addEventListener("click", pingEsp);

espIpInput.addEventListener("change", async () => {
  const ip = espIpInput.value.trim(); if (!ip) return;
  try { await fetch(FLASK_BASE + "/update-esp-ip", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ip}) }); } catch(e) {}
});

async function sendToBoat() {
  if (!state.lastPath.length) { showEspResult("No waypoints generated yet.", false); return; }
  sendBoatBtn.disabled = true; sendBoatBtn.innerHTML = '<span class="spinner"></span> Sending…'; showEspResult("", false);
  const waypoints = state.lastPath.map(([lat,lon]) => ({lat,lon}));
  try {
    const resp = await fetch(FLASK_BASE + "/send-to-esp", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({waypoints}) });
    const data = await resp.json();
    if (resp.ok && data.status === "ok") {
      showEspResult("✓ " + data.message, true); setStep(4); setStatus("✓ Waypoints sent to ESP32 boat", "success");
      showToast("🚀 Waypoints sent! Starting mission...", "success", 1500);
      lastWaypoints = waypoints;
      document.getElementById('repeatBtn').disabled = false;
      document.getElementById('repeatBtn').style.opacity = '1';
      setTimeout(() => { showView('monitor'); }, 1500);
    } else {
      showEspResult("✗ " + (data.error || "Unknown error"), false); setStatus("ESP32 error: " + (data.error || "Unknown"), "error");
    }
  } catch(err) {
    showEspResult("✗ Network error: " + err.message, false); setStatus("ESP32 connection failed", "error");
  } finally {
    sendBoatBtn.disabled = false;
    sendBoatBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 20h20"/><path d="M3.5 15h17l-2-7H5.5L3.5 15z"/><path d="M12 4v4"/><path d="M9 4h6"/></svg> Send to Boat';
  }
}

async function pingEsp() {
  espStatusDot.className = "control-value esp-status-dot"; espStatusDot.title = "Checking…";
  espPingBtn.disabled = true; espPingBtn.textContent = "…";
  try {
    const resp = await fetch(FLASK_BASE + "/esp-status"); const data = await resp.json();
    if (data.online) { espStatusDot.classList.add("online"); espStatusDot.title = "ESP32 online"; showEspResult("✓ ESP32 online at "+data.ip, true); }
    else { espStatusDot.classList.add("offline"); espStatusDot.title = "ESP32 offline"; showEspResult("✗ ESP32 offline at "+data.ip, false); }
  } catch(err) { espStatusDot.classList.add("offline"); espStatusDot.title = "Cannot reach server"; showEspResult("✗ Server error", false); }
  finally { espPingBtn.disabled = false; espPingBtn.textContent = "Ping"; }
}
function showEspResult(msg, ok) {
  if (!msg) { espResult.style.display = "none"; return; }
  espResult.style.display = "block"; espResult.textContent = msg; espResult.className = "esp-result " + (ok ? "result-ok" : "result-err");
}

// ═══════════════════════════════════════════════════════════════════════════
// MONITOR (AquaSense Dashboard) — from EcoTidev2-main/static/script.js
// ═══════════════════════════════════════════════════════════════════════════
const MAX_CHART_POINTS = 30;
let monCharts = {};

function getMonEl() {
  return {
    btnReport: document.getElementById('btn-report'),
    btnStart: document.getElementById('btn-start'),
    btnStop: document.getElementById('btn-stop'),
    monitorDot: document.getElementById('monitor-dot'),
    monitorText: document.getElementById('monitor-text'),
    backendDot: document.getElementById('backend-dot'),
    backendText: document.getElementById('backend-text'),
    valTemp: document.getElementById('val-temp'),
    avgTemp: document.getElementById('avg-temp'),
    valPH: document.getElementById('val-ph'),
    avgPH: document.getElementById('avg-ph'),
    valTDS: document.getElementById('val-tds'),
    avgTDS: document.getElementById('avg-tds'),
    valTB: document.getElementById('val-tb'),
    avgTB: document.getElementById('avg-tb'),
    valNH3: document.getElementById('val-nh3'),
    avgNH3: document.getElementById('avg-nh3'),
    valReadingCount: document.getElementById('val-reading-count'),
    wqiCard: document.getElementById('wqi-card'),
    wqiQuality: document.getElementById('wqi-quality'),
    wqiValue: document.getElementById('val-wqi')
  };
}

function initMonitor() {
  initMonCharts();
  setupMonitorListeners();
  checkBackendStatus();
  fetchHistory();
}

function setupMonitorListeners() {
  const mel = getMonEl();
  mel.btnStart.addEventListener('click', async () => {
    try { const res = await fetch(FASTAPI_BASE+"/monitor/start",{method:'POST'}); if(res.ok) updateMonitoringStatus(true); } catch(e){ console.error('Error starting monitor',e); }
  });
  mel.btnStop.addEventListener('click', async () => {
    try { const res = await fetch(FASTAPI_BASE+"/monitor/stop",{method:'POST'}); if(res.ok) updateMonitoringStatus(false); } catch(e){ console.error('Error stopping monitor',e); }
  });
  mel.btnReport.addEventListener('click', () => {
    const loc = prompt("Enter location name for the report (e.g., Main Water Tank):", "Unknown Location");
    if (loc !== null) window.open(FASTAPI_BASE+"/report?location="+encodeURIComponent(loc), '_blank');
  });
}

async function checkBackendStatus() {
  const mel = getMonEl();
  try {
    const res = await fetch(FASTAPI_BASE+"/monitor/status");
    if(res.ok){ const data=await res.json(); mel.backendDot.className='dot green'; mel.backendText.textContent='Backend Online'; updateMonitoringStatus(data.monitoring_enabled); return true; }
  } catch(e){ mel.backendDot.className='dot red'; mel.backendText.textContent='Backend Offline'; mel.monitorDot.className='dot'; mel.monitorText.textContent='Unknown Status'; return false; }
}

function updateMonitoringStatus(isActive) {
  const mel = getMonEl();
  if(isActive){ mel.monitorDot.className='dot green'; mel.monitorText.textContent='Monitoring Active'; mel.btnStart.style.display='none'; mel.btnStop.style.display='flex'; }
  else { mel.monitorDot.className='dot yellow'; mel.monitorText.textContent='Monitoring Paused'; mel.btnStart.style.display='flex'; mel.btnStop.style.display='none'; }
}

async function fetchHistory() {
  try {
    const res = await fetch(FASTAPI_BASE+"/history"); if(!res.ok) return;
    const data = await res.json();
    if(data.length > 0){
      updateMonUI(data[data.length-1]);
      const slice = data.slice(-MAX_CHART_POINTS); const labels = slice.map(d => "#"+d.id);
      updateMonChartData(monCharts.wqi, labels, slice.map(d=>d.wqi));
      updateMonChartData(monCharts.temp, labels, slice.map(d=>d.temperature));
      updateMonChartData(monCharts.ph, labels, slice.map(d=>d.ph));
      updateMonChartData(monCharts.tds, labels, slice.map(d=>d.tds));
      updateMonChartData(monCharts.tb, labels, slice.map(d=>d.turbidity));
      updateMonChartData(monCharts.nh3, labels, slice.map(d=>d.nh3));
    }
  } catch(e){ console.error('Failed to fetch history',e); }
}

async function updateDashboard() {
  const isOnline = await checkBackendStatus(); if(!isOnline) return;
  try {
    const res = await fetch(FASTAPI_BASE+"/latest"); if(!res.ok) return;
    const data = await res.json();
    if(data){ updateMonUI(data); appendMonChartData(data); }
  } catch(e){ console.error('Failed to fetch latest data',e); }
}

function updateMonUI(data) {
  const mel = getMonEl();
  mel.valTemp.textContent = data.temperature.toFixed(2); mel.avgTemp.textContent = data.temperature_avg.toFixed(2);
  mel.valPH.textContent = data.ph.toFixed(2); mel.avgPH.textContent = data.ph_avg.toFixed(2);
  mel.valTDS.textContent = data.tds.toFixed(2); mel.avgTDS.textContent = data.tds_avg.toFixed(2);
  mel.valTB.textContent = data.turbidity.toFixed(2); mel.avgTB.textContent = data.turbidity_avg.toFixed(2);
  mel.valNH3.textContent = data.nh3.toFixed(2); mel.avgNH3.textContent = data.nh3_avg.toFixed(2);
  mel.valReadingCount.textContent = data.reading_count; mel.wqiValue.textContent = Math.round(data.wqi); mel.wqiQuality.textContent = data.quality;
  toggleAbnormal(mel.valTemp, data.temperature<0||data.temperature>40);
  toggleAbnormal(mel.valPH, data.ph<6.5||data.ph>8.5);
  toggleAbnormal(mel.valTDS, data.tds>1000);
  toggleAbnormal(mel.valTB, data.turbidity>5);
  toggleAbnormal(mel.valNH3, data.nh3>1.5);
  applyWQITheme(data.quality);
}

function toggleAbnormal(element,isAbnormal) { if(isAbnormal) element.classList.add('value-critical'); else element.classList.remove('value-critical'); }

function applyWQITheme(qualityStr) {
  const mel = getMonEl(); const q = qualityStr.toLowerCase(); let tc = 'wqi-moderate';
  if(q.includes('excellent')) tc='wqi-excellent'; else if(q.includes('good')) tc='wqi-good';
  else if(q.includes('very poor')) tc='wqi-very-poor'; else if(q.includes('poor')) tc='wqi-poor';
  else if(q.includes('moderate')) tc='wqi-moderate';
  mel.wqiCard.className = 'wqi-banner '+tc;
  let colorHex='#fff';
  if(tc==='wqi-excellent') colorHex='var(--accent-1)'; if(tc==='wqi-good') colorHex='var(--status-good)';
  if(tc==='wqi-moderate') colorHex='var(--status-moderate)'; if(tc==='wqi-poor') colorHex='var(--status-poor)';
  if(tc==='wqi-very-poor') colorHex='var(--status-very-poor)';
  
  const isLight = document.body.classList.contains('light-mode');
  const startColor = isLight ? 'var(--text-primary)' : '#fff';
  mel.wqiQuality.style.background = `-webkit-linear-gradient(0deg, ${startColor}, ${colorHex})`;
  mel.wqiQuality.style.webkitBackgroundClip = 'text'; mel.wqiQuality.style.webkitTextFillColor = 'transparent';
}

// Charts
function getThemeColors() {
  const isLight = document.body.classList.contains('light-mode');
  return {
    text: isLight ? '#0F172A' : 'rgba(255,255,255,0.8)',
    muted: isLight ? '#64748B' : 'rgba(255,255,255,0.4)',
    grid: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)',
    cardBg: isLight ? '#FFFFFF' : '#111827'
  };
}

function initMonCharts() {
  const tc = getThemeColors();
  Chart.defaults.color = tc.muted;
  Chart.defaults.font.family = "'Inter', sans-serif";
  
  const co = {
    responsive:true, maintainAspectRatio:false,
    plugins:{legend:{display:false}},
    scales:{ 
      x:{ grid:{color:tc.grid}, ticks:{color:tc.muted} }, 
      y:{ grid:{color:tc.grid}, ticks:{color:tc.muted}, beginAtZero:false } 
    },
    elements:{ line:{tension:0.4,borderWidth:3}, point:{radius:0,hitRadius:10,hoverRadius:5} },
    animation:{duration:500}
  };

  const mk = (ctxId,title,clr,bg) => {
    const ctx = document.getElementById(ctxId).getContext('2d');
    const g = ctx.createLinearGradient(0,0,0,240); 
    g.addColorStop(0,bg||clr); g.addColorStop(1,'rgba(0,0,0,0)');
    
    return new Chart(ctx, { 
      type:'line', 
      data:{labels:[],datasets:[{label:title,data:[],borderColor:clr,backgroundColor:g,fill:true}]},
      options:{
        ...co, 
        plugins:{
          title:{display:true,text:title,color:tc.text,font:{size:14,weight:'600'},padding:{bottom:20}},
          legend:{display:false}
        }
      } 
    });
  };
  monCharts.wqi = mk('chartWQI','WQI Trend','#8b5cf6','rgba(139,92,246,0.2)');
  monCharts.temp = mk('chartTemp','Temperature (°C)','#f43f5e','rgba(244,63,94,0.2)');
  monCharts.ph = mk('chartPH','pH Level','#10b981','rgba(16,185,129,0.2)');
  monCharts.tds = mk('chartTDS','TDS (ppm)','#3b82f6','rgba(59,130,246,0.2)');
  monCharts.tb = mk('chartTurbidity','Turbidity (NTU)','#eab308','rgba(234,179,8,0.2)');
  monCharts.nh3 = mk('chartNH3','Ammonia (ppm)','#a855f7','rgba(168,85,247,0.2)');
}

function updateChartTheme() {
  const tc = getThemeColors();
  Chart.defaults.color = tc.muted;
  
  Object.values(monCharts).forEach(chart => {
    if (!chart) return;
    chart.options.scales.x.grid.color = tc.grid;
    chart.options.scales.x.ticks.color = tc.muted;
    chart.options.scales.y.grid.color = tc.grid;
    chart.options.scales.y.ticks.color = tc.muted;
    chart.options.plugins.title.color = tc.text;
    chart.update('none'); // Update without animation for a snappier switch
  });
}

function updateMonChartData(chart,labels,dataPoints) { chart.data.labels=labels; chart.data.datasets[0].data=dataPoints; chart.update(); }

function appendMonChartData(record) {
  const label = "#"+record.id;
  const ap = (chart,value) => {
    if(chart.data.labels.length>0 && chart.data.labels[chart.data.labels.length-1]===label) return;
    chart.data.labels.push(label); chart.data.datasets[0].data.push(value);
    if(chart.data.labels.length>MAX_CHART_POINTS){ chart.data.labels.shift(); chart.data.datasets[0].data.shift(); }
    chart.update('none');
  };
  ap(monCharts.wqi,record.wqi); ap(monCharts.temp,record.temperature); ap(monCharts.ph,record.ph);
  ap(monCharts.tds,record.tds); ap(monCharts.tb,record.turbidity); ap(monCharts.nh3,record.nh3);
}

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION CONTROL (ESP8266)
// ═══════════════════════════════════════════════════════════════════════════

// Send movement command to ESP8266
let currentBoatMode = 'manual';

async function sendCmd(direction) {
  // Block movement commands if in AUTO mode
  if (currentBoatMode === 'auto' && direction !== 'stop') return;

  try {
    const res = await fetch(`${ESP8266_BASE}/${direction}`,
                            { method: 'GET' });
    if (!res.ok) throw new Error('Bad response');
  } catch (e) {
    document.getElementById('esp8266Status').textContent =
      '❌ Unreachable';
    document.getElementById('esp8266Status').style.color =
      '#f44336';
  }
}

// Switch between auto/manual modes
async function setMode(mode) {
  try {
    const res = await fetch(`${ESP8266_BASE}/mode/${mode}`);
    const data = await res.json();
    currentBoatMode = data.mode;
    document.getElementById('modeLabel').textContent =
      mode.toUpperCase();
    document.getElementById('modeBanner').style.backgroundColor =
      mode === 'auto' ? '#1a4a1a' : '#2a2a2a';
    document.getElementById('esp8266Status').textContent =
      '✅ Connected';
    document.getElementById('esp8266Status').style.color =
      '#4caf50';
  } catch (e) {
    document.getElementById('esp8266Status').textContent =
      '❌ Unreachable';
  }
}

// Poll ESP8266 status when Navigation tab is active
let navPollInterval = null;

function startNavPolling() {
  navPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${ESP8266_BASE}/`);
      const data = await res.json();
      currentBoatMode = data.mode;
      document.getElementById('modeLabel').textContent =
        data.mode.toUpperCase();
      document.getElementById('esp8266Status').textContent =
        '✅ Connected';
      document.getElementById('esp8266Status').style.color =
        '#4caf50';
    } catch (e) {
      document.getElementById('esp8266Status').textContent =
        '❌ Unreachable';
      document.getElementById('esp8266Status').style.color =
        '#f44336';
    }
  }, 3000);  // poll every 3 seconds
}

function stopNavPolling() {
  if (navPollInterval) {
    clearInterval(navPollInterval);
    navPollInterval = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REPEAT MISSION (Reversed Path)
// ═══════════════════════════════════════════════════════════════════════════

async function repeatMission() {
  if (!lastWaypoints || lastWaypoints.length === 0) return;

  // Reverse the waypoint array for the return journey
  const reversedWaypoints = [...lastWaypoints].reverse();

  const btn = document.getElementById('repeatBtn');
  btn.textContent = '⏳ Sending return path...';
  btn.disabled = true;

  try {
    const res = await fetch('http://localhost:5000/send-to-esp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waypoints: reversedWaypoints })
    });

    if (res.ok) {
      showToast('Return path sent — boat retracing route...');
      setTimeout(() => showView('monitor'), 1500);
    } else {
      showToast('Failed to send return path');
    }
  } catch (e) {
    showToast('Could not reach Flask backend');
  } finally {
    btn.textContent = '🔁 Repeat Mission (Return Path)';
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AI MISSION REPORT (Groq API)
// ═══════════════════════════════════════════════════════════════════════════

async function generateAIReport() {
  const btn = document.getElementById('aiReportBtn');
  btn.textContent = '⏳ Generating...';
  btn.disabled = true;

  const box = document.getElementById('aiReportBox');
  box.style.display = 'block';
  box.textContent = 'Analysing session data...';

  try {
    // Fetch all data needed for the report
    const [histRes, latestRes] = await Promise.all([
      fetch('http://localhost:8000/history'),
      fetch('http://localhost:8000/latest')
    ]);

    const history = await histRes.json();
    const latest = await latestRes.json();

    // Build WQI trend string from last 20 readings
    const wqiTrend = history.slice(-20)
                            .map(r => r.wqi)
                            .join(', ');

    // Compute simple per-parameter averages for context
    const avg = (key) => {
      const vals = history.map(r => r[key]).filter(v => v != null);
      return vals.length
        ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)
        : 'N/A';
    };

    const prompt = `You are an environmental field analyst.
An autonomous boat has just completed a water quality survey
mission. Write a concise mission report based on this data.

SESSION DATA:
- Total readings collected: ${history.length}
- Current WQI: ${latest.wqi}/100 (${latest.quality})
- Latest values: pH ${latest.ph}, Turbidity ${latest.turbidity} NTU,
  TDS ${latest.tds} ppm, Temperature ${latest.temperature}°C,
  Ammonia ${latest.nh3} ppm
- Session averages: pH ${avg('ph')}, Turbidity ${avg('turbidity')} NTU,
  TDS ${avg('tds')} ppm, Ammonia ${avg('nh3')} ppm
- WQI trend (last 20 readings, oldest→newest): ${wqiTrend}

Write 2-3 short paragraphs covering:
1. Overall water quality assessment with specific numbers
2. Any notable trends visible in the WQI data
3. A clear recommendation — is a second remediation pass needed?

Use plain language suitable for an environmental field report.
Be specific. Do not invent data not provided above.`;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            {
              role: "system",
              content: "You are an environmental field analyst writing concise and professional mission reports."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.4,
          max_tokens: 500
        })
      }
    );

    const data = await response.json();

    if (data.choices && data.choices.length > 0) {
      box.textContent = data.choices[0].message.content.trim();
    } else {
      box.textContent = 'No response received from Groq API.';
    }

  } catch (e) {
    box.textContent = 'Failed to generate report. Check your Groq API key and ensure both backends are running.';
  } finally {
    btn.textContent = '🤖 AI Summary';
    btn.disabled = false;
  }
}
