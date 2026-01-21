# MorseForge Keylink Mobile App

Expo React Native app for receiving Morse key input from a BLE HID keyboard
(Keylink) and playing sidetone audio.

## Features

- External keyboard input (Ctrl+[ / Ctrl+]) from Keylink
- Real-time audio sidetone playback
- Straight + iambic keyer modes
- Event logging

## Setup

### 1. Install Dependencies

```bash
cd mobile_app
npm install
```

### 2. Run on iOS (Physical Device Required)

```bash
npx expo run:ios
```

**Note:** This app uses a native module (`react-native-external-keyboard`), so
Expo Go will not work. Use a dev build (see `BUILDING.md`).

### 3. Flash your Keylink device

Flash the Arduino firmware from:
`../software/keylink_ble_keyboard/keylink_ble_keyboard.ino`

### 4. Connect

1. Pair Keylink in your phone's Bluetooth settings (it appears as "Keylink").
2. Open the app and tap **Focus Input** if needed.
3. Press the paddles to hear tones.

## Configuration

### Keyer Modes

The app supports three keyer modes:
- **Straight Key**: Both paddles act as a simple straight key (continuous tone while pressed)
- **Iambic A**: Automatic alternating dits and dahs with paddle squeeze
- **Iambic B**: Enhanced iambic mode with improved squeeze behavior

Switch modes using the mode selector buttons in the app.

### Input Protocol

The firmware sends BLE HID key combos:
- DIT (left paddle): **Ctrl + [**
- DAH (right paddle): **Ctrl + ]**

The app listens for these external keyboard events using
`react-native-external-keyboard`.

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

### No key events
- Ensure Keylink is paired as a Bluetooth keyboard in system settings
- Tap **Focus Input** in the app to regain keyboard focus
- Verify the firmware is flashed and powered on

### No audio on key press
- Check phone is not in silent mode (iOS)
- Ensure `assets/tone.wav` exists
- Check console for audio initialization errors

## Project Structure

```
mobile_app/
├── App.js           # Main application code
├── app.json         # Expo configuration
├── package.json     # Dependencies
├── assets/
│   └── tone.wav     # Sidetone audio file
└── README.md        # This file
```
