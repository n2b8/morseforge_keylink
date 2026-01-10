# Building MorseForge Keylink for iOS and Android

Since this app uses native modules (BLE), you cannot use Expo Go. You need to create a development build.

## Option 1: Build Locally with Xcode (Recommended for Testing)

### Prerequisites
- Xcode installed
- iOS development certificate
- Your iPhone connected via USB

### Steps

1. Install iOS dependencies:
```bash
cd mobile_app
npx expo prebuild
```

2. Open the iOS project in Xcode:
```bash
open ios/mobileapp.xcworkspace
```

3. In Xcode:
   - Select your connected iPhone as the target device
   - Select your development team in Signing & Capabilities
   - Click the Play button to build and run

4. The app will install on your iPhone

## Option 2: Build with EAS (For Production)

### Prerequisites
- Expo account (free)
- EAS CLI installed

### Steps

1. Install EAS CLI:
```bash
npm install -g eas-cli
```

2. Login to Expo:
```bash
eas login
```

3. Configure EAS:
```bash
eas build:configure
```

4. Create a development build:
```bash
eas build --profile development --platform ios
```

5. When complete, scan the QR code with your iPhone to install

## Option 3: Quick Test with Expo Dev Client

1. Install expo-dev-client:
```bash
npx expo install expo-dev-client
```

2. Start development:
```bash
npx expo start --dev-client
```

3. Follow on-screen instructions to build and install on your device

## Android (Physical Device Required for BLE)

1. Install dependencies:
```bash
cd mobile_app
npm install
```

2. Build and install on a connected device:
```bash
npx expo run:android
```

3. Grant Nearby Devices and Location permissions when prompted

## Troubleshooting

### "Signing requires a development team"
- In Xcode, go to Signing & Capabilities
- Select your Apple ID team
- Xcode will automatically create a provisioning profile

### "Unable to install"
- Make sure your iPhone trusts your Mac
- Check that Developer Mode is enabled on iOS 16+ (Settings > Privacy & Security > Developer Mode)

### BLE not working
- Ensure Bluetooth is enabled on your iPhone
- Grant Bluetooth permissions when prompted
- Check that your ESP32 is powered on and running the firmware
- If scans return nothing, toggle Scan Filter to "All" and try again
- Ensure `newArchEnabled` is true in `app.json` (required for `react-native-ble-manager`)
