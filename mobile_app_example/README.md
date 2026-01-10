# MorseForge Keylink Mobile App (Sample)

This is a sample React Native app that connects to an ESP32 Morse key over BLE
and plays an audible sidetone for key activity.

This folder is a code-only sample. Use the setup steps below to drop it into a
React Native CLI project.

## BLE expectations

Update the constants in `mobile_app_example/App.js` to match your firmware:

- `SERVICE_UUID`
- `CHAR_UUID`
- `DEVICE_NAME_PREFIX` (set to an empty string to show all devices)

Notification payloads supported by the parser:

- ASCII text: `DIT_DOWN`, `DIT_UP`, `DAH_DOWN`, `DAH_UP`, `DIT`, `DAH`
- ASCII symbols: `.` for DIT, `-` for DAH
- Single-byte codes:
  - `0x01` = DIT_DOWN
  - `0x02` = DIT_UP
  - `0x03` = DAH_DOWN
  - `0x04` = DAH_UP
  - `0x05` = DIT
  - `0x06` = DAH

If you only emit `DIT` and `DAH`, the app plays one-shot tones using
`DIT_MS` and `DAH_MS`. If you emit DOWN/UP events, it plays a continuous tone
for the duration of the key press.

## Audio asset

The app expects a `tone.wav` file. This repo provides a simple 1-second tone at
`mobile_app_example/assets/tone.wav`.

Add it to your native project resources:

- iOS: add `tone.wav` to the Xcode project (Copy Bundle Resources).
- Android: copy `tone.wav` into `android/app/src/main/res/raw/`.

## Suggested setup (bare React Native)

1. Create a React Native app:
   - `npx react-native@0.73.6 init MorseForgeKeylinkMobile`
2. Copy these files into your app:
   - `mobile_app_example/App.js`
   - `mobile_app_example/index.js`
   - `mobile_app_example/app.json`
   - `mobile_app_example/assets/tone.wav`
3. Install dependencies:
   - `npm install react-native-ble-plx react-native-sound buffer`
4. Add Bluetooth permissions:
   - iOS `Info.plist`:
     - `NSBluetoothAlwaysUsageDescription`
   - Android `AndroidManifest.xml`:
     - `android.permission.BLUETOOTH_SCAN`
     - `android.permission.BLUETOOTH_CONNECT`
     - `android.permission.ACCESS_FINE_LOCATION` (pre-Android 12)
5. Run:
   - `npx react-native run-ios`
   - `npx react-native run-android`

## Notes

- If your ESP32 does not advertise the service UUID, set
  `SCAN_SERVICE_UUIDS` in `App.js` to `null` (it is already `null` in the
  sample).
- For Android 12+, you may need to add `usesPermissionFlags="neverForLocation"`
  to the `BLUETOOTH_SCAN` permission in `AndroidManifest.xml`.
