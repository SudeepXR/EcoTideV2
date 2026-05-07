from flask import Flask, request, jsonify, render_template
import math
import numpy as np
import requests as http_requests
from shapely.geometry import Polygon, LineString, MultiLineString
from flask_cors import CORS
app = Flask(__name__)

CORS(app) 

# ─── ESP32 Configuration ──────────────────────────────────────────────────────
# Change this to your ESP32's IP address on the local WiFi network.
# The ESP32 prints its IP to Serial on boot.
ESP32_IP = "192.168.1.100"
ESP32_PORT = 80
ESP32_TIMEOUT = 5  # seconds

# ─── Coordinate Conversion ────────────────────────────────────────────────────

METERS_PER_DEGREE_LAT = 111320.0  # approximate metres per degree of latitude


def latlon_to_xy(lat, lon, ref_lat, ref_lon):
    """Convert lat/lon to x/y metres using equirectangular projection."""
    x = (lon - ref_lon) * METERS_PER_DEGREE_LAT * math.cos(math.radians(ref_lat))
    y = (lat - ref_lat) * METERS_PER_DEGREE_LAT
    return x, y


def xy_to_latlon(x, y, ref_lat, ref_lon):
    """Convert x/y metres back to lat/lon."""
    lat = ref_lat + y / METERS_PER_DEGREE_LAT
    lon = ref_lon + x / (METERS_PER_DEGREE_LAT * math.cos(math.radians(ref_lat)))
    return lat, lon


# ─── Coverage Path Algorithm ──────────────────────────────────────────────────

def generate_lawnmower_path(polygon_latlon, spacing_m):
    """
    Generate a lawnmower (zig-zag) coverage path inside the given polygon.

    Args:
        polygon_latlon: list of [lat, lon] pairs defining the polygon boundary.
        spacing_m:      distance between sweep lines in metres.

    Returns:
        List of [lat, lon] pairs forming the continuous zig-zag path.
    """
    if len(polygon_latlon) < 3:
        return []

    # Use the first vertex as the local Cartesian origin
    ref_lat, ref_lon = polygon_latlon[0]

    # Convert all vertices to metres
    xy_coords = [latlon_to_xy(lat, lon, ref_lat, ref_lon) for lat, lon in polygon_latlon]

    # Build a Shapely polygon (close it if not already closed)
    if xy_coords[0] != xy_coords[-1]:
        xy_coords.append(xy_coords[0])
    poly = Polygon(xy_coords)

    if not poly.is_valid:
        poly = poly.buffer(0)  # attempt to fix self-intersections

    # Bounding box in metres
    minx, miny, maxx, maxy = poly.bounds

    # Generate horizontal sweep lines from bottom to top
    path_points_xy = []
    y_values = np.arange(miny + spacing_m / 2, maxy, spacing_m)

    for i, y in enumerate(y_values):
        # Create a long horizontal line that spans the bounding box
        sweep_line = LineString([(minx - 1, y), (maxx + 1, y)])
        intersection = poly.intersection(sweep_line)

        if intersection.is_empty:
            continue

        # Collect all line segments from this sweep
        segments = []
        if intersection.geom_type == "LineString":
            coords = list(intersection.coords)
            if len(coords) >= 2:
                segments.append(coords)
        elif intersection.geom_type == "MultiLineString":
            for geom in intersection.geoms:
                coords = list(geom.coords)
                if len(coords) >= 2:
                    segments.append(coords)

        if not segments:
            continue

        # Sort segments left-to-right by their leftmost x
        segments.sort(key=lambda seg: min(c[0] for c in seg))

        # On odd rows reverse the direction for zig-zag continuity
        if i % 2 == 1:
            segments = [list(reversed(seg)) for seg in reversed(segments)]

        for seg in segments:
            path_points_xy.extend(seg)

    # Convert back to lat/lon
    path_latlon = [xy_to_latlon(x, y, ref_lat, ref_lon) for x, y in path_points_xy]
    return [[lat, lon] for lat, lon in path_latlon]


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/generate-path", methods=["POST"])
def generate_path():
    data = request.get_json(force=True)

    polygon = data.get("polygon", [])
    spacing = float(data.get("spacing", 10))

    if len(polygon) < 3:
        return jsonify({"error": "Polygon must have at least 3 points"}), 400

    spacing = max(1.0, min(spacing, 500.0))  # clamp to reasonable range

    path = generate_lawnmower_path(polygon, spacing)

    return jsonify({"path": path})


@app.route("/send-to-esp", methods=["POST"])
def send_to_esp():
    """
    Proxy endpoint: receives waypoints from the frontend and forwards them
    to the ESP32's HTTP server via POST /upload-waypoints.
    """
    data = request.get_json(force=True)
    waypoints = data.get("waypoints", [])

    if not waypoints:
        return jsonify({"error": "No waypoints to send"}), 400

    # Cap at 200 waypoints (ESP32 memory limit)
    if len(waypoints) > 200:
        waypoints = waypoints[:200]
        app.logger.warning("Waypoints truncated to 200 for ESP32 memory safety")

    esp_url = f"http://{ESP32_IP}:{ESP32_PORT}/upload-waypoints"
    payload = {"waypoints": waypoints}

    try:
        app.logger.info(f"Sending {len(waypoints)} waypoints to ESP32 at {esp_url}")
        resp = http_requests.post(esp_url, json=payload, timeout=ESP32_TIMEOUT)

        if resp.status_code == 200:
            app.logger.info("ESP32 acknowledged waypoints successfully")
            return jsonify({
                "status": "ok",
                "message": f"Sent {len(waypoints)} waypoints to ESP32",
                "esp_response": resp.text,
            })
        else:
            app.logger.error(f"ESP32 returned status {resp.status_code}: {resp.text}")
            return jsonify({
                "error": f"ESP32 returned status {resp.status_code}",
                "details": resp.text,
            }), 502

    except http_requests.exceptions.ConnectionError:
        app.logger.error(f"Cannot connect to ESP32 at {esp_url}")
        return jsonify({"error": f"Cannot connect to ESP32 at {ESP32_IP}:{ESP32_PORT}. Is it powered on and connected to WiFi?"}), 503
    except http_requests.exceptions.Timeout:
        app.logger.error(f"Timeout connecting to ESP32 at {esp_url}")
        return jsonify({"error": f"ESP32 at {ESP32_IP} did not respond within {ESP32_TIMEOUT}s"}), 504
    except Exception as e:
        app.logger.error(f"Unexpected error sending to ESP32: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/esp-status", methods=["GET"])
def esp_status():
    """Check whether the ESP32 is reachable."""
    esp_url = f"http://{ESP32_IP}:{ESP32_PORT}/waypoints"
    try:
        resp = http_requests.get(esp_url, timeout=ESP32_TIMEOUT)
        return jsonify({"online": True, "ip": ESP32_IP, "response": resp.json()})
    except Exception:
        return jsonify({"online": False, "ip": ESP32_IP})


@app.route("/update-esp-ip", methods=["POST"])
def update_esp_ip():
    """Allow frontend to change the ESP32 target IP at runtime."""
    global ESP32_IP
    data = request.get_json(force=True)
    new_ip = data.get("ip", "").strip()
    if not new_ip:
        return jsonify({"error": "IP address required"}), 400
    ESP32_IP = new_ip
    app.logger.info(f"ESP32 IP updated to {ESP32_IP}")
    return jsonify({"status": "ok", "ip": ESP32_IP})


if __name__ == "__main__":
    app.run(debug=True, port=5000, host="0.0.0.0")
