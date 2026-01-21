# MorseForge Keylink

**Keylink** is an open‑source hardware adapter that makes traditional Morse keys Bluetooth‑capable.

It is designed and maintained by the **MorseForge developer** as a companion device for upcoming external‑key features in the **MorseForge** app.

🌐 **MorseForge:** https://morseforge.com

---

## What is Keylink?

Keylink bridges classic Morse key hardware with modern Bluetooth‑enabled devices. It allows straight keys, paddles, and other traditional Morse inputs to transmit key events wirelessly using Bluetooth Low Energy (BLE).

Keylink is intended to:
- Enable wireless Morse key input
- Integrate directly with future MorseForge app features
- Remain compact, battery‑powered, and easy to assemble
- Be fully open source and community‑friendly

Unlike generic microcontroller dev boards, Keylink is a **purpose‑built Morse interface**.

---

## Hardware Overview — Rev B

The current hardware revision (Rev B) includes:

- **ESP32‑C3 microcontroller (Seeed XIAO form factor)**
- **3.5 mm stereo jack (SJ1‑3523N)** for Morse key input
- **Slide power switch** for battery isolation
- **JST‑PH 2.0 mm battery connector**
- LiPo battery support
- Passive input conditioning network

This revision has been fabricated via OSH Park and is undergoing validation.

---

## PCB Renders (Rev B)

### Top View
![Keylink Rev B Top](hardware/keylink_revB/keylink_revB_top.png)

### Bottom View
![Keylink Rev B Bottom](hardware/keylink_revB/keylink_revB_bottom.png)

> Renders generated from KiCad’s 3D viewer. These are not production photographs.

---

## Repository Structure

```
hardware/
├── keylink_revB/     # KiCad schematic + PCB layout
├── gerber/           # Manufacturing Gerbers
mobile_app/           # React Native example app
software/             # Firmware (Arduino + legacy)
```

Additional firmware and software directories will be added as development progresses.

---

## Firmware & App Integration

Keylink firmware now uses the Arduino framework and exposes the device as a BLE
HID keyboard for Vail Adapter compatibility. The sketch lives at:
`software/keylink_ble_keyboard/keylink_ble_keyboard.ino`.

Key events:
- DIT (left paddle) sends Ctrl + [
- DAH (right paddle) sends Ctrl + ]

### Flashing (Arduino)

1. Install Arduino IDE and the ESP32 board package.
2. Install the "ESP32 BLE Keyboard" library (T-vK).
3. Open `software/keylink_ble_keyboard` in Arduino IDE.
4. Select board "Seeed XIAO ESP32C3" and flash.
5. Pair the device as "Keylink" in your OS Bluetooth settings.

The prior CircuitPython UART firmware remains at `software/code.py` for
reference but is not Vail-compatible.

---

## Open Source

This project is released as open‑source hardware and software.

Licensing details will be finalized and documented explicitly, but the intent is:
- **Permissive open hardware**
- **Permissive firmware licensing**
- Community contributions welcome

---

## Disclaimer

This is experimental hardware.

No warranties are provided.  
Use at your own risk.

---

## Author

Keylink is designed and maintained by the **MorseForge developer** as part of the broader MorseForge ecosystem.

🌐 https://morseforge.com
