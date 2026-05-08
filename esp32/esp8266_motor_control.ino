/*
 * ══════════════════════════════════════════════════════════════════════════════
 *  ESP8266 Motor Control Firmware — EcoTide Boat
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Provides HTTP endpoints for manual motor control and mode switching.
 *  Designed to work with the unified EcoTide frontend (index.html).
 *
 *  Hardware:
 *    - ESP8266 (NodeMCU / Wemos D1 Mini)
 *    - Motor driver (2-channel) — e.g. L298N or L293D
 *
 *  Endpoints:
 *    GET /           → JSON status (mode + ok)
 *    GET /forward    → Drive forward
 *    GET /backward   → Drive backward
 *    GET /left       → Turn left
 *    GET /right      → Turn right
 *    GET /stop       → Stop motors
 *    GET /mode/manual → Switch to manual mode
 *    GET /mode/auto   → Switch to auto mode
 *
 * ══════════════════════════════════════════════════════════════════════════════
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>

// Update this to match ESP8266's IP shown in Serial Monitor
// after connecting to WiFi
const char* ESP8266_IP = "192.168.x.x";  // placeholder

// ─── WiFi Configuration ──────────────────────────────────────────────────────
const char* ssid     = "Megha";
const char* password = "hello1234";

// ─── Pin Definitions ─────────────────────────────────────────────────────────
// Motor 1 (Left)
const int motor1Pin1 = D1;  // IN1
const int motor1Pin2 = D2;  // IN2

// Motor 2 (Right)
const int motor2Pin1 = D3;  // IN3
const int motor2Pin2 = D4;  // IN4

// ─── Mode State ──────────────────────────────────────────────────────────────
enum BoatMode { AUTO_MODE, MANUAL_MODE };
BoatMode currentMode = MANUAL_MODE;

// ─── Web Server ──────────────────────────────────────────────────────────────
ESP8266WebServer server(80);

// ══════════════════════════════════════════════════════════════════════════════
//  CORS HELPER
// ══════════════════════════════════════════════════════════════════════════════
void addCORSHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods",
                    "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers",
                    "Content-Type");
}

// ══════════════════════════════════════════════════════════════════════════════
//  ENDPOINT HANDLERS
// ══════════════════════════════════════════════════════════════════════════════
void handleRoot() {
  addCORSHeaders();
  String json = "{\"mode\":\"";
  json += (currentMode == AUTO_MODE) ? "auto" : "manual";
  json += "\",\"status\":\"ok\"}";
  server.send(200, "application/json", json);
}

void moveForward() {
  addCORSHeaders();
  digitalWrite(motor1Pin1, HIGH); digitalWrite(motor1Pin2, LOW);
  digitalWrite(motor2Pin1, HIGH); digitalWrite(motor2Pin2, LOW);
  server.send(200, "application/json", "{\"status\":\"ok\"}");
}

void moveBackward() {
  addCORSHeaders();
  digitalWrite(motor1Pin1, LOW); digitalWrite(motor1Pin2, HIGH);
  digitalWrite(motor2Pin1, LOW); digitalWrite(motor2Pin2, HIGH);
  server.send(200, "application/json", "{\"status\":\"ok\"}");
}

void turnLeft() {
  addCORSHeaders();
  digitalWrite(motor1Pin1, LOW);  digitalWrite(motor1Pin2, HIGH);
  digitalWrite(motor2Pin1, HIGH); digitalWrite(motor2Pin2, LOW);
  server.send(200, "application/json", "{\"status\":\"ok\"}");
}

void turnRight() {
  addCORSHeaders();
  digitalWrite(motor1Pin1, HIGH); digitalWrite(motor1Pin2, LOW);
  digitalWrite(motor2Pin1, LOW);  digitalWrite(motor2Pin2, HIGH);
  server.send(200, "application/json", "{\"status\":\"ok\"}");
}

void stopMotors() {
  addCORSHeaders();
  digitalWrite(motor1Pin1, LOW); digitalWrite(motor1Pin2, LOW);
  digitalWrite(motor2Pin1, LOW); digitalWrite(motor2Pin2, LOW);
  server.send(200, "application/json", "{\"status\":\"ok\"}");
}

// ─── Mode Switching ──────────────────────────────────────────────────────────
void setManualMode() {
  addCORSHeaders();
  currentMode = MANUAL_MODE;
  // Stop motors when switching to manual
  digitalWrite(motor1Pin1, LOW); digitalWrite(motor1Pin2, LOW);
  digitalWrite(motor2Pin1, LOW); digitalWrite(motor2Pin2, LOW);
  server.send(200, "application/json", "{\"mode\":\"manual\"}");
}

void setAutoMode() {
  addCORSHeaders();
  currentMode = AUTO_MODE;
  // Auto mode: drive forward indefinitely (GPS placeholder)
  digitalWrite(motor1Pin1, HIGH); digitalWrite(motor1Pin2, LOW);
  digitalWrite(motor2Pin1, HIGH); digitalWrite(motor2Pin2, LOW);
  server.send(200, "application/json", "{\"mode\":\"auto\"}");
}

// ══════════════════════════════════════════════════════════════════════════════
//  SETUP
// ══════════════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] ESP8266 Motor Control Firmware");
  Serial.println("======================================");

  // Motor pins
  pinMode(motor1Pin1, OUTPUT);
  pinMode(motor1Pin2, OUTPUT);
  pinMode(motor2Pin1, OUTPUT);
  pinMode(motor2Pin2, OUTPUT);

  // All motors off at boot
  digitalWrite(motor1Pin1, LOW); digitalWrite(motor1Pin2, LOW);
  digitalWrite(motor2Pin1, LOW); digitalWrite(motor2Pin2, LOW);
  Serial.println("[MOT]  Motors initialised (all OFF)");

  // WiFi
  Serial.printf("[WIFI] Connecting to %s", ssid);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! IP: %s\n",
                  WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WIFI] FAILED to connect. Restarting...");
    ESP.restart();
  }

  // ── HTTP Routes ────────────────────────────────────────────────────────
  server.on("/", HTTP_GET, handleRoot);

  // CORS preflight for root
  server.on("/", HTTP_OPTIONS, []() {
    addCORSHeaders();
    server.send(204);
  });

  // Movement endpoints
  server.on("/forward",  moveForward);
  server.on("/backward", moveBackward);
  server.on("/left",     turnLeft);
  server.on("/right",    turnRight);
  server.on("/stop",     stopMotors);

  // Mode switching endpoints
  server.on("/mode/manual", setManualMode);
  server.on("/mode/auto",   setAutoMode);

  // Global CORS handler for any preflight OPTIONS request
  server.onNotFound([]() {
    addCORSHeaders();
    server.send(204);
  });

  server.begin();
  Serial.println("[HTTP] Web server started on port 80");
  Serial.println("======================================\n");
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN LOOP
// ══════════════════════════════════════════════════════════════════════════════
void loop() {
  server.handleClient();

  // Keep motors running forward in AUTO mode
  // (GPS navigation placeholder — replace when GPS is working)
  if (currentMode == AUTO_MODE) {
    digitalWrite(motor1Pin1, HIGH); digitalWrite(motor1Pin2, LOW);
    digitalWrite(motor2Pin1, HIGH); digitalWrite(motor2Pin2, LOW);
  }
}
