import time
import board
import digitalio

# BLE imports - requires adafruit_ble from the CircuitPython bundle
try:
    from adafruit_ble import BLERadio
    from adafruit_ble.advertising.standard import ProvideServicesAdvertisement
    from adafruit_ble.services.nordic import UARTService
    BLE_AVAILABLE = True
except ImportError:
    BLE_AVAILABLE = False
    print("WARNING: BLE libraries not found. Install adafruit_ble library bundle.")

# ----------------------------
# CONFIG (XIAO ESP32C3 PIN MAP)
# ----------------------------
# TRRS tip (left) -> GPIO7 (board.D5)
# TRRS ring (right) -> GPIO21 (board.D6)
DIT_PIN = board.D5     # TRRS TIP / left (GPIO7)
DAH_PIN = board.D6     # TRRS RING / right (GPIO21)
DEBOUNCE_S = 0.010     # 10ms debounce

# ----------------------------
# Optional onboard NeoPixel (no neopixel module needed)
# ----------------------------
PIXEL_ENABLED = True
PIXEL_PIN = getattr(board, "NEOPIXEL", None)
_pixel_io = None
_pixel_ok = False

def pixel_init():
    global _pixel_io, _pixel_ok
    if not PIXEL_ENABLED:
        return
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
    if not _pixel_ok or not PIXEL_ENABLED:
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
ble = None
uart = None
advertisement = None
if BLE_AVAILABLE:
    ble = BLERadio()
    ble.name = "MorseKey"
    uart = UARTService()
    advertisement = ProvideServicesAdvertisement(uart)
    # Keep the device name in the primary advertisement for iOS discovery.
    advertisement.complete_name = ble.name
    print(f"Advertisement services: {advertisement.services}")

last_connected = False
last_uart_error = 0.0

def ble_is_connected() -> bool:
    return bool(BLE_AVAILABLE and ble and ble.connected)

def safe_uart_write(event_text: str) -> None:
    global last_uart_error
    if not ble_is_connected():
        return
    try:
        uart.write((event_text + "\n").encode("utf-8"))
    except Exception as exc:
        now = time.monotonic()
        if (now - last_uart_error) > 2.0:
            print("UART write failed:", repr(exc))
            last_uart_error = now

print("=== MorseForge TRRS + BLE (Seeed XIAO ESP32C3) ===")
print("DIT pin:", DIT_PIN)
print("DAH pin:", DAH_PIN)
print("Debounce:", int(DEBOUNCE_S * 1000), "ms")
if BLE_AVAILABLE:
    print("BLE Name:", ble.name)
    print("Starting BLE advertising...")
    ble.start_advertising(advertisement)
    print("Ready. Press paddles/key...")
else:
    print("BLE not available - running in serial-only mode")
    print("Ready. Press paddles/key...")

# ----------------------------
# Main loop
# ----------------------------
while True:
    now = time.monotonic()

    # Check for BLE connection changes
    if BLE_AVAILABLE and ble:
        connected_now = ble.connected
        if connected_now != last_connected:
            last_connected = connected_now
            if connected_now:
                print("BLE connected.")
                pixel_set(12, 0, 12)  # purple = connected
            else:
                print("BLE disconnected.")
                if not ble.advertising:
                    print("Restarting BLE advertising...")
                    ble.start_advertising(advertisement)
                pixel_set(0, 0, 12)  # idle blue

    # DIT edge detect with debounce
    cur_dit = dit.value
    if cur_dit != last_dit and (now - last_change_dit) >= DEBOUNCE_S:
        last_change_dit = now
        last_dit = cur_dit

        if not cur_dit:
            # Key pressed (active low)
            event = "K1:1"  # Key 1 (dit/left paddle) pressed
            print(f"{ms()} DIT_DOWN")
            pixel_set(0, 20, 0)   # green
            safe_uart_write(event)
        else:
            # Key released
            event = "K1:0"  # Key 1 (dit/left paddle) released
            print(f"{ms()} DIT_UP")
            if BLE_AVAILABLE and ble and ble.connected:
                pixel_set(12, 0, 12)
            else:
                pixel_set(0, 0, 12)
            safe_uart_write(event)

    # DAH edge detect with debounce
    cur_dah = dah.value
    if cur_dah != last_dah and (now - last_change_dah) >= DEBOUNCE_S:
        last_change_dah = now
        last_dah = cur_dah

        if not cur_dah:
            # Key pressed (active low)
            event = "K2:1"  # Key 2 (dah/right paddle) pressed
            print(f"{ms()} DAH_DOWN")
            pixel_set(0, 0, 20)   # blue brighter
            safe_uart_write(event)
        else:
            # Key released
            event = "K2:0"  # Key 2 (dah/right paddle) released
            print(f"{ms()} DAH_UP")
            if BLE_AVAILABLE and ble and ble.connected:
                pixel_set(12, 0, 12)
            else:
                pixel_set(0, 0, 12)
            safe_uart_write(event)

    time.sleep(0.001)
