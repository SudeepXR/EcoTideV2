/*
 * ══════════════════════════════════════════════════════════════════════════════
 *  ESP32 Autonomous Boat Navigation Firmware
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Receives waypoints from the Flask web app over WiFi HTTP, then navigates
 *  through them using GPS + compass with differential motor control.
 *
 *  Hardware:
 *    - ESP32 DevKit
 *    - GPS module (UART) → e.g. NEO-6M on Serial2 (RX=16, TX=17)
 *    - Compass / magnetometer → e.g. QMC5883L / HMC5883L on I2C
 *    - Motor driver (2-channel) → e.g. L298N or BTS7960
 *
 *  Libraries required (install via Arduino Library Manager):
 *    - TinyGPS++
 *    - ArduinoJson (v6 or v7)
 *    - Wire (built-in)
 *    - WiFi (built-in ESP32)
 *    - WebServer (built-in ESP32)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <TinyGPS++.h>
#include <Wire.h>
#include <math.h>

// ─── WiFi Configuration ──────────────────────────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// ─── Pin Definitions ─────────────────────────────────────────────────────────
// GPS UART (Serial2)
#define GPS_RX_PIN 16
#define GPS_TX_PIN 17
#define GPS_BAUD   9600

// Motor Driver (L298N style — adjust for your driver)
#define MOTOR_LEFT_FWD   25
#define MOTOR_LEFT_BWD   26
#define MOTOR_RIGHT_FWD  27
#define MOTOR_RIGHT_BWD  14
#define MOTOR_LEFT_EN    32  // PWM enable
#define MOTOR_RIGHT_EN   33  // PWM enable

// Compass I2C (default SDA=21, SCL=22)
#define COMPASS_ADDR     0x0D  // QMC5883L; use 0x1E for HMC5883L

// ─── Navigation Parameters ──────────────────────────────────────────────────
#define WAYPOINT_REACH_DIST  3.0   // metres — switch to next waypoint
#define MAX_WAYPOINTS        200
#define BASE_SPEED           180   // PWM 0-255
#define TURN_SPEED           120
#define HEADING_TOLERANCE    10.0  // degrees — go straight if error < this
#define NAV_UPDATE_MS        200   // navigation loop interval

// ─── PWM Config ──────────────────────────────────────────────────────────────
#define PWM_FREQ     5000
#define PWM_RES      8
#define PWM_CH_LEFT  0
#define PWM_CH_RIGHT 1

// ─── Globals ─────────────────────────────────────────────────────────────────
struct Waypoint {
  double lat;
  double lon;
};

Waypoint waypoints[MAX_WAYPOINTS];
int waypointCount = 0;
int currentWaypointIndex = 0;
bool navigationActive = false;

TinyGPSPlus gps;
WebServer server(80);

double currentLat = 0.0;
double currentLon = 0.0;
double currentHeading = 0.0;  // degrees from compass (0 = North)
bool gpsValid = false;

unsigned long lastNavUpdate = 0;
unsigned long lastDebugPrint = 0;

// ══════════════════════════════════════════════════════════════════════════════
//  SETUP
// ══════════════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] ESP32 Boat Navigation Firmware");
  Serial.println("======================================");

  // GPS Serial
  Serial2.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("[GPS]  Serial2 initialised");

  // I2C for compass
  Wire.begin();
  initCompass();

  // Motor pins
  setupMotors();

  // WiFi
  connectWiFi();

  // HTTP Server endpoints
  setupServerRoutes();
  server.begin();
  Serial.println("[HTTP] Web server started on port 80");
  Serial.println("======================================\n");
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN LOOP (non-blocking)
// ══════════════════════════════════════════════════════════════════════════════
void loop() {
  // 1. Handle incoming HTTP requests
  server.handleClient();

  // 2. Feed GPS data
  while (Serial2.available() > 0) {
    gps.encode(Serial2.read());
  }

  // 3. Update GPS position
  if (gps.location.isUpdated()) {
    currentLat = gps.location.lat();
    currentLon = gps.location.lng();
    gpsValid = true;
  }

  // 4. Read compass heading
  currentHeading = readCompass();

  // 5. Navigation loop (throttled)
  unsigned long now = millis();
  if (navigationActive && (now - lastNavUpdate >= NAV_UPDATE_MS)) {
    lastNavUpdate = now;
    navigateToWaypoint();
  }

  // 6. Debug output every 2 seconds
  if (now - lastDebugPrint >= 2000) {
    lastDebugPrint = now;
    printDebugInfo();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  WiFi
// ══════════════════════════════════════════════════════════════════════════════
void connectWiFi() {
  Serial.printf("[WIFI] Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WIFI] FAILED to connect. Restarting...");
    ESP.restart();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  HTTP Server Routes
// ══════════════════════════════════════════════════════════════════════════════
void setupServerRoutes() {
  // GET /waypoints — return current stored waypoints
  server.on("/waypoints", HTTP_GET, []() {
    StaticJsonDocument<256> doc;
    doc["waypointCount"] = waypointCount;
    doc["currentIndex"] = currentWaypointIndex;
    doc["navigationActive"] = navigationActive;
    doc["gpsValid"] = gpsValid;

    String response;
    serializeJson(doc, response);
    server.send(200, "application/json", response);
  });

  // POST /upload-waypoints — receive waypoints from Flask backend
  server.on("/upload-waypoints", HTTP_POST, []() {
    if (!server.hasArg("plain")) {
      server.send(400, "application/json", "{\"error\":\"No body\"}");
      return;
    }

    String body = server.arg("plain");
    Serial.printf("[HTTP] Received waypoint upload (%d bytes)\n", body.length());

    // Parse JSON
    DynamicJsonDocument doc(32768);  // ~32KB for up to 200 waypoints
    DeserializationError err = deserializeJson(doc, body);

    if (err) {
      Serial.printf("[HTTP] JSON parse error: %s\n", err.c_str());
      server.send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
      return;
    }

    JsonArray wpArray = doc["waypoints"].as<JsonArray>();
    if (wpArray.isNull()) {
      server.send(400, "application/json", "{\"error\":\"Missing waypoints array\"}");
      return;
    }

    // Stop navigation while loading new waypoints
    navigationActive = false;
    stopMotors();

    // Load waypoints
    waypointCount = 0;
    currentWaypointIndex = 0;

    for (JsonObject wp : wpArray) {
      if (waypointCount >= MAX_WAYPOINTS) break;

      waypoints[waypointCount].lat = wp["lat"].as<double>();
      waypoints[waypointCount].lon = wp["lon"].as<double>();
      waypointCount++;
    }

    Serial.printf("[HTTP] Loaded %d waypoints\n", waypointCount);

    // Print first few for verification
    int printCount = min(waypointCount, 5);
    for (int i = 0; i < printCount; i++) {
      Serial.printf("  WP[%d]: lat=%.7f, lon=%.7f\n",
                     i, waypoints[i].lat, waypoints[i].lon);
    }
    if (waypointCount > 5) {
      Serial.printf("  ... and %d more\n", waypointCount - 5);
    }

    // Start navigation if we have waypoints and GPS
    if (waypointCount > 0) {
      navigationActive = true;
      Serial.println("[NAV]  Navigation STARTED");
    }

    // Respond to Flask
    StaticJsonDocument<128> resp;
    resp["status"] = "ok";
    resp["loaded"] = waypointCount;
    String response;
    serializeJson(resp, response);
    server.send(200, "application/json", response);
  });

  // POST /stop — emergency stop
  server.on("/stop", HTTP_POST, []() {
    navigationActive = false;
    stopMotors();
    Serial.println("[NAV]  EMERGENCY STOP via HTTP");
    server.send(200, "application/json", "{\"status\":\"stopped\"}");
  });

  // POST /resume — resume navigation
  server.on("/resume", HTTP_POST, []() {
    if (waypointCount > 0 && currentWaypointIndex < waypointCount) {
      navigationActive = true;
      Serial.println("[NAV]  Navigation RESUMED via HTTP");
      server.send(200, "application/json", "{\"status\":\"resumed\"}");
    } else {
      server.send(400, "application/json", "{\"error\":\"No waypoints or mission complete\"}");
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  NAVIGATION CORE
// ══════════════════════════════════════════════════════════════════════════════
void navigateToWaypoint() {
  // Guard: no waypoints or GPS not ready
  if (waypointCount == 0 || !gpsValid) {
    stopMotors();
    return;
  }

  // Guard: mission complete
  if (currentWaypointIndex >= waypointCount) {
    navigationActive = false;
    stopMotors();
    Serial.println("[NAV]  *** MISSION COMPLETE ***");
    return;
  }

  double targetLat = waypoints[currentWaypointIndex].lat;
  double targetLon = waypoints[currentWaypointIndex].lon;

  // Compute distance (metres)
  double dist = haversineDistance(currentLat, currentLon, targetLat, targetLon);

  // Check if waypoint reached
  if (dist < WAYPOINT_REACH_DIST) {
    Serial.printf("[NAV]  Reached WP[%d] (dist=%.1fm)\n", currentWaypointIndex, dist);
    currentWaypointIndex++;

    if (currentWaypointIndex >= waypointCount) {
      navigationActive = false;
      stopMotors();
      Serial.println("[NAV]  *** MISSION COMPLETE ***");
      return;
    }
    Serial.printf("[NAV]  Next target: WP[%d]\n", currentWaypointIndex);
    return;  // re-evaluate on next cycle
  }

  // Compute desired bearing to target
  double bearing = computeBearing(currentLat, currentLon, targetLat, targetLon);

  // Heading error (normalised to -180..+180)
  double headingError = normalizeAngle(bearing - currentHeading);

  // Motor control based on heading error
  if (fabs(headingError) < HEADING_TOLERANCE) {
    // Go straight
    driveForward(BASE_SPEED);
  } else if (headingError > 0) {
    // Turn right
    turnRight(TURN_SPEED);
  } else {
    // Turn left
    turnLeft(TURN_SPEED);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  MATH UTILITIES
// ══════════════════════════════════════════════════════════════════════════════
double haversineDistance(double lat1, double lon1, double lat2, double lon2) {
  const double R = 6371000.0;  // Earth radius in metres
  double dLat = radians(lat2 - lat1);
  double dLon = radians(lon2 - lon1);
  double a = sin(dLat / 2.0) * sin(dLat / 2.0) +
             cos(radians(lat1)) * cos(radians(lat2)) *
             sin(dLon / 2.0) * sin(dLon / 2.0);
  double c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a));
  return R * c;
}

double computeBearing(double lat1, double lon1, double lat2, double lon2) {
  double dLon = radians(lon2 - lon1);
  double y = sin(dLon) * cos(radians(lat2));
  double x = cos(radians(lat1)) * sin(radians(lat2)) -
             sin(radians(lat1)) * cos(radians(lat2)) * cos(dLon);
  double bearing = degrees(atan2(y, x));
  // Normalise to 0..360
  if (bearing < 0) bearing += 360.0;
  return bearing;
}

double normalizeAngle(double angle) {
  while (angle > 180.0)  angle -= 360.0;
  while (angle < -180.0) angle += 360.0;
  return angle;
}

// ══════════════════════════════════════════════════════════════════════════════
//  MOTOR CONTROL
// ══════════════════════════════════════════════════════════════════════════════
void setupMotors() {
  // Configure PWM channels
  ledcSetup(PWM_CH_LEFT, PWM_FREQ, PWM_RES);
  ledcSetup(PWM_CH_RIGHT, PWM_FREQ, PWM_RES);
  ledcAttachPin(MOTOR_LEFT_EN, PWM_CH_LEFT);
  ledcAttachPin(MOTOR_RIGHT_EN, PWM_CH_RIGHT);

  // Direction pins
  pinMode(MOTOR_LEFT_FWD, OUTPUT);
  pinMode(MOTOR_LEFT_BWD, OUTPUT);
  pinMode(MOTOR_RIGHT_FWD, OUTPUT);
  pinMode(MOTOR_RIGHT_BWD, OUTPUT);

  stopMotors();
  Serial.println("[MOT]  Motors initialised");
}

void driveForward(int speed) {
  digitalWrite(MOTOR_LEFT_FWD, HIGH);
  digitalWrite(MOTOR_LEFT_BWD, LOW);
  digitalWrite(MOTOR_RIGHT_FWD, HIGH);
  digitalWrite(MOTOR_RIGHT_BWD, LOW);
  ledcWrite(PWM_CH_LEFT, speed);
  ledcWrite(PWM_CH_RIGHT, speed);
}

void turnLeft(int speed) {
  // Left motor backward, right motor forward
  digitalWrite(MOTOR_LEFT_FWD, LOW);
  digitalWrite(MOTOR_LEFT_BWD, HIGH);
  digitalWrite(MOTOR_RIGHT_FWD, HIGH);
  digitalWrite(MOTOR_RIGHT_BWD, LOW);
  ledcWrite(PWM_CH_LEFT, speed);
  ledcWrite(PWM_CH_RIGHT, speed);
}

void turnRight(int speed) {
  // Left motor forward, right motor backward
  digitalWrite(MOTOR_LEFT_FWD, HIGH);
  digitalWrite(MOTOR_LEFT_BWD, LOW);
  digitalWrite(MOTOR_RIGHT_FWD, LOW);
  digitalWrite(MOTOR_RIGHT_BWD, HIGH);
  ledcWrite(PWM_CH_LEFT, speed);
  ledcWrite(PWM_CH_RIGHT, speed);
}

void stopMotors() {
  digitalWrite(MOTOR_LEFT_FWD, LOW);
  digitalWrite(MOTOR_LEFT_BWD, LOW);
  digitalWrite(MOTOR_RIGHT_FWD, LOW);
  digitalWrite(MOTOR_RIGHT_BWD, LOW);
  ledcWrite(PWM_CH_LEFT, 0);
  ledcWrite(PWM_CH_RIGHT, 0);
}

// ══════════════════════════════════════════════════════════════════════════════
//  COMPASS (QMC5883L)
// ══════════════════════════════════════════════════════════════════════════════
void initCompass() {
  // QMC5883L: set continuous mode, 200Hz, 8G range, 512 oversampling
  Wire.beginTransmission(COMPASS_ADDR);
  Wire.write(0x0B);  // SET/RESET register
  Wire.write(0x01);
  Wire.endTransmission();

  Wire.beginTransmission(COMPASS_ADDR);
  Wire.write(0x09);  // Control register
  Wire.write(0x1D);  // Continuous, 200Hz, 8G, 512 OSR
  Wire.endTransmission();

  Serial.println("[CMP]  Compass initialised (QMC5883L)");
}

double readCompass() {
  // Read 6 bytes of magnetometer data
  Wire.beginTransmission(COMPASS_ADDR);
  Wire.write(0x00);  // Data register start
  Wire.endTransmission();

  Wire.requestFrom((uint8_t)COMPASS_ADDR, (uint8_t)6);
  if (Wire.available() < 6) {
    return currentHeading;  // return last known if read fails
  }

  int16_t x = Wire.read() | (Wire.read() << 8);
  int16_t y = Wire.read() | (Wire.read() << 8);
  // z not used for heading: Wire.read() | (Wire.read() << 8);
  Wire.read(); Wire.read();  // discard z bytes

  // Compute heading from x,y
  double heading = degrees(atan2((double)y, (double)x));
  if (heading < 0) heading += 360.0;

  return heading;
}

// ══════════════════════════════════════════════════════════════════════════════
//  DEBUG OUTPUT
// ══════════════════════════════════════════════════════════════════════════════
void printDebugInfo() {
  Serial.println("── STATUS ──────────────────────────────");
  Serial.printf("  GPS:      %s  (lat=%.7f, lon=%.7f, sats=%d)\n",
                gpsValid ? "VALID" : "NO FIX",
                currentLat, currentLon,
                gps.satellites.isValid() ? (int)gps.satellites.value() : 0);
  Serial.printf("  Heading:  %.1f°\n", currentHeading);
  Serial.printf("  Waypoints: %d loaded, current target: WP[%d]\n",
                waypointCount, currentWaypointIndex);
  Serial.printf("  Nav:      %s\n", navigationActive ? "ACTIVE" : "IDLE");

  if (navigationActive && currentWaypointIndex < waypointCount && gpsValid) {
    double targetLat = waypoints[currentWaypointIndex].lat;
    double targetLon = waypoints[currentWaypointIndex].lon;
    double dist = haversineDistance(currentLat, currentLon, targetLat, targetLon);
    double bearing = computeBearing(currentLat, currentLon, targetLat, targetLon);
    double headingErr = normalizeAngle(bearing - currentHeading);
    Serial.printf("  Target:   lat=%.7f, lon=%.7f\n", targetLat, targetLon);
    Serial.printf("  Distance: %.1f m\n", dist);
    Serial.printf("  Bearing:  %.1f°  Error: %.1f°\n", bearing, headingErr);
  }
  Serial.println("────────────────────────────────────────\n");
}
