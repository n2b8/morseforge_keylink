#define USE_NIMBLE
#include <BleKeyboard.h>

// Keylink Rev B (Seeed XIAO ESP32C3)
// TRRS tip (left) -> GPIO7 (D5)
// TRRS ring (right) -> GPIO21 (D6)
const int DIT_PIN = 7;
const int DAH_PIN = 21;
const uint32_t DEBOUNCE_MS = 10;

const char DIT_KEY = '[';
const char DAH_KEY = ']';

BleKeyboard bleKeyboard("Keylink", "MorseForge", 100);

bool lastDitState = true;
bool lastDahState = true;
uint32_t lastDitChange = 0;
uint32_t lastDahChange = 0;

bool ditPressed = false;
bool dahPressed = false;
bool ctrlHeld = false;
bool lastConnected = false;

void resetKeyState() {
  ditPressed = false;
  dahPressed = false;
  ctrlHeld = false;
  bleKeyboard.releaseAll();
}

void applyConnectionState(bool connected) {
  if (connected == lastConnected) {
    return;
  }
  lastConnected = connected;
  if (!connected) {
    resetKeyState();
  }
}

void sendComboDown(char key) {
  if (!bleKeyboard.isConnected()) {
    return;
  }
  if (!ctrlHeld) {
    bleKeyboard.press(KEY_LEFT_CTRL);
    ctrlHeld = true;
  }
  bleKeyboard.press(key);
}

void sendComboUp(char key) {
  if (!bleKeyboard.isConnected()) {
    return;
  }
  bleKeyboard.release(key);
  if (!ditPressed && !dahPressed && ctrlHeld) {
    bleKeyboard.release(KEY_LEFT_CTRL);
    ctrlHeld = false;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(DIT_PIN, INPUT_PULLUP);
  pinMode(DAH_PIN, INPUT_PULLUP);
  bleKeyboard.begin();
}

void loop() {
  const bool connected = bleKeyboard.isConnected();
  applyConnectionState(connected);

  const uint32_t now = millis();

  const bool ditState = digitalRead(DIT_PIN);
  if (ditState != lastDitState && (now - lastDitChange) >= DEBOUNCE_MS) {
    lastDitChange = now;
    lastDitState = ditState;
    if (!ditState) {
      ditPressed = true;
      sendComboDown(DIT_KEY);
    } else {
      ditPressed = false;
      sendComboUp(DIT_KEY);
    }
  }

  const bool dahState = digitalRead(DAH_PIN);
  if (dahState != lastDahState && (now - lastDahChange) >= DEBOUNCE_MS) {
    lastDahChange = now;
    lastDahState = dahState;
    if (!dahState) {
      dahPressed = true;
      sendComboDown(DAH_KEY);
    } else {
      dahPressed = false;
      sendComboUp(DAH_KEY);
    }
  }

  delay(1);
}
