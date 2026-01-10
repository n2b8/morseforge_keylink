# MorseForge Keylink Mobile App

Expo React Native app for connecting to the MorseForge Keylink BLE device and playing morse key tones.

## Features

- BLE connectivity to ESP32 morse key device
- Real-time audio sidetone playback
- Supports DIT_DOWN/UP and DAH_DOWN/UP events for continuous tones
- Dark theme UI
- Event logging

## Setup

### 1. Install Dependencies

```bash
cd mobile_app
npm install
```

### 2. Run on iOS (Physical Device Required for BLE)

```bash
npx expo run:ios
```

Or build and install using Expo Go:

```bash
npx expo start
```

Then scan the QR code with your iPhone.

**Note:** BLE functionality requires a physical device - it won't work in the simulator.

### 3. Flash your ESP32 device

Make sure your ESP32 is flashed with the firmware from `../software/code.py`. The device should advertise as "MorseKey" over BLE.

### 4. Connect

1. Open the app on your iPhone
2. Tap "Scan" to search for nearby BLE devices
3. Tap "Connect" on your "MorseKey" device
4. Press your morse key paddles - you should hear tones!

## Configuration

### Keyer Modes

The app supports three keyer modes:
- **Straight Key**: Both paddles act as a simple straight key (continuous tone while pressed)
- **Iambic A**: Automatic alternating dits and dahs with paddle squeeze
- **Iambic B**: Enhanced iambic mode with improved squeeze behavior

Switch modes using the mode selector buttons in the app.

### BLE Protocol

The firmware sends key state messages in the format: `K{key}:{state}`

- `K1:1` - Key 1 (dit/left paddle) pressed
- `K1:0` - Key 1 (dit/left paddle) released
- `K2:1` - Key 2 (dah/right paddle) pressed
- `K2:0` - Key 2 (dah/right paddle) released

**BLE UUIDs:**
- Service: `6e400001-b5a3-f393-e0a9-e50e24dcca9e` (Nordic UART Service)
- TX Characteristic: `6e400003-b5a3-f393-e0a9-e50e24dcca9e`

### Tone Timing

Edit `App.js` to adjust:
- `DIT_MS = 60` - Duration of dit tone (milliseconds)
- `DAH_MS = 180` - Duration of dah tone (milliseconds)

## Building for Production

### iOS

1. Install EAS CLI:
```bash
npm install -g eas-cli
```

2. Configure EAS:
```bash
eas build:configure
```

3. Build for iOS:
```bash
eas build --platform ios
```

### Android

```bash
eas build --platform android
```

## Troubleshooting

### "Audio: Loading..." never changes
- Check that `assets/tone.wav` exists
- Check console for audio initialization errors

### Can't find device
- Ensure ESP32 is powered on and running code.py
- Device must advertise as "MorseKey"
- Check BLE permissions are granted

### No audio on key press
- Check phone is not in silent mode (iOS)
- Ensure connection is established (status shows "Connected")
- Check event log for incoming messages

## Project Structure

```
mobile_app/
├── App.js           # Main application code
├── app.json         # Expo configuration with BLE permissions
├── package.json     # Dependencies
├── assets/
│   └── tone.wav     # Sidetone audio file
└── README.md        # This file
```
