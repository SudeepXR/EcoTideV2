// Configuration
const API_BASE = "http://localhost:8000"; // Relative to server
const UPDATE_INTERVAL = 2000;
const MAX_CHART_POINTS = 30; // Number of historical points to keep in view

// Chart Instances
let charts = {};

// DOM Elements
const el = {
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

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', async () => {
    initCharts();
    setupEventListeners();

    // Initial fetch
    await checkBackendStatus();
    await fetchHistory();

    // Start interval
    setInterval(updateDashboard, UPDATE_INTERVAL);
});

// Setup Event Listeners
function setupEventListeners() {
    el.btnStart.addEventListener('click', async () => {
        try {
            const res = await fetch(`${API_BASE}/monitor/start`, { method: 'POST' });
            if (res.ok) updateMonitoringStatus(true);
        } catch (e) { console.error('Error starting monitor', e); }
    });

    el.btnStop.addEventListener('click', async () => {
        try {
            const res = await fetch(`${API_BASE}/monitor/stop`, { method: 'POST' });
            if (res.ok) updateMonitoringStatus(false);
        } catch (e) { console.error('Error stopping monitor', e); }
    });

    el.btnReport.addEventListener('click', () => {
        const locationName = prompt("Enter location name for the report (e.g., Main Water Tank):", "Unknown Location");
        if (locationName !== null) {
            const url = `${API_BASE}/report?location=${encodeURIComponent(locationName)}`;
            window.open(url, '_blank');
        }
    });
}

// Backend & Monitor Status
async function checkBackendStatus() {
    try {
        const res = await fetch(`${API_BASE}/monitor/status`);
        if (res.ok) {
            const data = await res.json();
            el.backendDot.className = 'dot green';
            el.backendText.textContent = 'Backend Online';
            updateMonitoringStatus(data.monitoring_enabled);
            return true;
        }
    } catch (e) {
        el.backendDot.className = 'dot red';
        el.backendText.textContent = 'Backend Offline';
        el.monitorDot.className = 'dot';
        el.monitorText.textContent = 'Unknown Status';
        return false;
    }
}

function updateMonitoringStatus(isActive) {
    if (isActive) {
        el.monitorDot.className = 'dot green';
        el.monitorText.textContent = 'Monitoring Active';
        el.btnStart.style.display = 'none';
        el.btnStop.style.display = 'flex';
    } else {
        el.monitorDot.className = 'dot yellow';
        el.monitorText.textContent = 'Monitoring Paused';
        el.btnStart.style.display = 'flex';
        el.btnStop.style.display = 'none';
    }
}

// Fetch Full History (Initial load)
async function fetchHistory() {
    try {
        const res = await fetch(`${API_BASE}/history`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.length > 0) {
            updateUI(data[data.length - 1]);

            // Populate Charts
            const slice = data.slice(-MAX_CHART_POINTS);
            const labels = slice.map(d => `#${d.id}`);

            updateChartData(charts.wqi, labels, slice.map(d => d.wqi));
            updateChartData(charts.temp, labels, slice.map(d => d.temperature));
            updateChartData(charts.ph, labels, slice.map(d => d.ph));
            updateChartData(charts.tds, labels, slice.map(d => d.tds));
            updateChartData(charts.tb, labels, slice.map(d => d.turbidity));
            updateChartData(charts.nh3, labels, slice.map(d => d.nh3));
        }
    } catch (e) {
        console.error('Failed to fetch history', e);
    }
}

// Interval Update (Latest record)
async function updateDashboard() {
    const isOnline = await checkBackendStatus();
    if (!isOnline) return;

    try {
        const res = await fetch(`${API_BASE}/latest`);
        if (!res.ok) return;
        const data = await res.json();
        if (data) {
            updateUI(data);
            appendChartData(data);
        }
    } catch (e) {
        console.error('Failed to fetch latest data', e);
    }
}

// Update DOM
function updateUI(data) {
    // Basic values
    el.valTemp.textContent = data.temperature.toFixed(2);
    el.avgTemp.textContent = data.temperature_avg.toFixed(2);

    el.valPH.textContent = data.ph.toFixed(2);
    el.avgPH.textContent = data.ph_avg.toFixed(2);

    el.valTDS.textContent = data.tds.toFixed(2);
    el.avgTDS.textContent = data.tds_avg.toFixed(2);

    el.valTB.textContent = data.turbidity.toFixed(2);
    el.avgTB.textContent = data.turbidity_avg.toFixed(2);

    el.valNH3.textContent = data.nh3.toFixed(2);
    el.avgNH3.textContent = data.nh3_avg.toFixed(2);

    el.valReadingCount.textContent = data.reading_count;
    el.wqiValue.textContent = Math.round(data.wqi);
    el.wqiQuality.textContent = data.quality;

    // Abnormal reading highlights (Example logic, can adjust thresholds)
    toggleAbnormal(el.valTemp, data.temperature < 0 || data.temperature > 40);
    toggleAbnormal(el.valPH, data.ph < 6.5 || data.ph > 8.5);
    toggleAbnormal(el.valTDS, data.tds > 1000);
    toggleAbnormal(el.valTB, data.turbidity > 5);
    toggleAbnormal(el.valNH3, data.nh3 > 1.5);

    // Apply WQI Theme styling
    applyWQITheme(data.quality);
}

function toggleAbnormal(element, isAbnormal) {
    if (isAbnormal) {
        element.classList.add('value-critical');
    } else {
        element.classList.remove('value-critical');
    }
}

function applyWQITheme(qualityStr) {
    const q = qualityStr.toLowerCase();
    let themeClass = 'wqi-moderate'; // fallback

    if (q.includes('excellent')) themeClass = 'wqi-excellent';
    else if (q.includes('good')) themeClass = 'wqi-good';
    else if (q.includes('very poor')) themeClass = 'wqi-very-poor';
    else if (q.includes('poor')) themeClass = 'wqi-poor';
    else if (q.includes('moderate')) themeClass = 'wqi-moderate';

    // Remove old classes and add new
    el.wqiCard.className = `wqi-banner ${themeClass}`;

    // Change wqi-status-label gradient text color depending on theme
    let colorHex = '#fff';
    if (themeClass === 'wqi-excellent') colorHex = 'var(--status-excellent)';
    if (themeClass === 'wqi-good') colorHex = 'var(--status-good)';
    if (themeClass === 'wqi-moderate') colorHex = 'var(--status-moderate)';
    if (themeClass === 'wqi-poor') colorHex = 'var(--status-poor)';
    if (themeClass === 'wqi-very-poor') colorHex = 'var(--status-very-poor)';

    el.wqiQuality.style.background = `-webkit-linear-gradient(0deg, #fff, ${colorHex})`;
    el.wqiQuality.style.webkitBackgroundClip = 'text';
    el.wqiQuality.style.webkitTextFillColor = 'transparent';
}

// Chart Configurations
function initCharts() {
    Chart.defaults.color = "rgba(255, 255, 255, 0.6)";
    Chart.defaults.font.family = "'Outfit', sans-serif";

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false }
        },
        scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: false } /* Let auto-scale for sensors */
        },
        elements: {
            line: { tension: 0.4, borderWidth: 3 },
            point: { radius: 0, hitRadius: 10, hoverRadius: 5 }
        },
        animation: { duration: 500 }
    };

    const createChart = (ctxId, title, colorHex, bgColorHex) => {
        const ctx = document.getElementById(ctxId).getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, bgColorHex || colorHex);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');

        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: title,
                    data: [],
                    borderColor: colorHex,
                    backgroundColor: gradient,
                    fill: true
                }]
            },
            options: {
                ...commonOptions,
                plugins: {
                    title: { display: true, text: title, color: '#f8fafc', font: { size: 16 } },
                    legend: { display: false }
                }
            }
        });
    };

    charts.wqi = createChart('chartWQI', 'WQI Trend', '#8b5cf6', 'rgba(139, 92, 246, 0.5)');
    charts.temp = createChart('chartTemp', 'Temperature (°C)', '#f43f5e', 'rgba(244, 63, 94, 0.5)');
    charts.ph = createChart('chartPH', 'pH Level', '#10b981', 'rgba(16, 185, 129, 0.5)');
    charts.tds = createChart('chartTDS', 'TDS (ppm)', '#3b82f6', 'rgba(59, 130, 246, 0.5)');
    charts.tb = createChart('chartTurbidity', 'Turbidity (NTU)', '#eab308', 'rgba(234, 179, 8, 0.5)');
    charts.nh3 = createChart('chartNH3', 'Ammonia (ppm)', '#a855f7', 'rgba(168, 85, 247, 0.5)');
}

function updateChartData(chart, labels, dataPoints) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = dataPoints;
    chart.update();
}

function appendChartData(record) {
    const label = `#${record.id}`;

    // Helper to append a single point and shift if needed
    const appendToChart = (chart, value) => {
        // If the latest point is already this record conceptually (fast polling), don't duplicate
        if (chart.data.labels.length > 0 && chart.data.labels[chart.data.labels.length - 1] === label) {
            return;
        }

        chart.data.labels.push(label);
        chart.data.datasets[0].data.push(value);

        if (chart.data.labels.length > MAX_CHART_POINTS) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }
        chart.update('none'); // Update without full animation to be smoother
    };

    appendToChart(charts.wqi, record.wqi);
    appendToChart(charts.temp, record.temperature);
    appendToChart(charts.ph, record.ph);
    appendToChart(charts.tds, record.tds);
    appendToChart(charts.tb, record.turbidity);
    appendToChart(charts.nh3, record.nh3);
}
