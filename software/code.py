import time
import board
import digitalio
from adafruit_ble import BLERadio
from adafruit_ble.advertising.standard import ProvideServicesAdvertisement
from adafruit_ble.services.nordic import UARTService

# ----------------------------
# CONFIG (LOCKED TO YOUR WORKING PINS)
# ----------------------------
DIT_PIN = board.IO14   # TRRS RIGHT (row 26)
DAH_PIN = board.A3     # TRRS LEFT  (row 29) - this is what your board resolved to
DEBOUNCE_S = 0.010     # 10ms debounce

# ----------------------------
# Optional onboard NeoPixel (no neopixel module needed)
# ----------------------------
PIXEL_PIN = getattr(board, "NEOPIXEL", None)
_pixel_io = None
_pixel_ok = False

def pixel_init():
    global _pixel_io, _pixel_ok
    if PIXEL_PIN is None:
        return
    try:
        import neopixel_write  # type: ignore
        _pixel_io = digitalio.DigitalInOut(PIXEL_PIN)
        _pixel_io.direction = digitalio.Direction.OUTPUT
        _pixel_ok = True
    except Exception:
        _pixel_ok = False

def pixel_set(r: int, g: int, b: int):
    """Set pixel color. Most NeoPixels are GRB order."""
    if not _pixel_ok:
        return
    import neopixel_write  # type: ignore
    r = max(0, min(255, r))
    g = max(0, min(255, g))
    b = max(0, min(255, b))
    neopixel_write.neopixel_write(_pixel_io, bytes([g, r, b]))

def pixel_off():
    pixel_set(0, 0, 0)

def ms() -> int:
    return int(time.monotonic() * 1000)

# ----------------------------
# Setup inputs (active-low with pullups)
# ----------------------------
dit = digitalio.DigitalInOut(DIT_PIN)
dit.direction = digitalio.Direction.INPUT
dit.pull = digitalio.Pull.UP

dah = digitalio.DigitalInOut(DAH_PIN)
dah.direction = digitalio.Direction.INPUT
dah.pull = digitalio.Pull.UP

last_dit = dit.value
last_dah = dah.value
last_change_dit = time.monotonic()
last_change_dah = time.monotonic()

pixel_init()
pixel_set(0, 0, 12)  # dim blue idle (if pixel is available)

# ----------------------------
# BLE Setup
# ----------------------------
ble = BLERadio()
ble.name = "MorseKey"
uart = UARTService()
advertisement = ProvideServicesAdvertisement(uart)

print("=== MorseForge TRRS + BLE (ESP32-C6) ===")
print("DIT pin:", DIT_PIN)
print("DAH pin:", DAH_PIN)
print("Debounce:", int(DEBOUNCE_S * 1000), "ms")
print("BLE Name:", ble.name)
print("Starting BLE advertising...")
ble.start_advertising(advertisement)
print("Ready. Press paddles/key...")

# ----------------------------
# Main loop
# ----------------------------
while True:
    now = time.monotonic()

    # Check for BLE connection changes
    if not ble.connected:
        if not ble.advertising:
            print("Restarting BLE advertising...")
            ble.start_advertising(advertisement)
            pixel_set(0, 0, 12)  # idle blue
    else:
        # Connected - show purple
        if ble.advertising:
            pixel_set(12, 0, 12)  # purple = connected

    # DIT edge detect with debounce
    cur_dit = dit.value
    if cur_dit != last_dit and (now - last_change_dit) >= DEBOUNCE_S:
        last_change_dit = now
        last_dit = cur_dit

        if not cur_dit:
            event = "DIT_DOWN"
            print(f"{ms()} {event}")
            pixel_set(0, 20, 0)   # green
            if ble.connected:
                uart.write((event + "\n").encode('utf-8'))
        else:
            event = "DIT_UP"
            print(f"{ms()} {event}")
            pixel_set(0, 0, 12) if not ble.connected else pixel_set(12, 0, 12)
            if ble.connected:
                uart.write((event + "\n").encode('utf-8'))

    # DAH edge detect with debounce
    cur_dah = dah.value
    if cur_dah != last_dah and (now - last_change_dah) >= DEBOUNCE_S:
        last_change_dah = now
        last_dah = cur_dah

        if not cur_dah:
            event = "DAH_DOWN"
            print(f"{ms()} {event}")
            pixel_set(0, 0, 20)   # blue brighter
            if ble.connected:
                uart.write((event + "\n").encode('utf-8'))
        else:
            event = "DAH_UP"
            print(f"{ms()} {event}")
            pixel_set(0, 0, 12) if not ble.connected else pixel_set(12, 0, 12)
            if ble.connected:
                uart.write((event + "\n").encode('utf-8'))

    time.sleep(0.001)
