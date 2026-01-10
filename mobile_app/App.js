import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import BleManager from 'react-native-ble-manager';
import {Audio} from 'expo-av';
import {Buffer} from 'buffer';

global.Buffer = global.Buffer || Buffer;

// BLE UART Service (Nordic UART Service standard UUIDs)
const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const CHAR_UUID_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';  // Notifications from device
const SCAN_SERVICE_UUIDS = [SERVICE_UUID];
const DEVICE_NAME_PREFIX = 'MorseKey';
const SCAN_TIMEOUT_S = 12;
const SCAN_FILTERS = {
  SERVICE: 'service',
  ALL: 'all',
};

const DIT_MS = 60;
const DAH_MS = 180;
const MAX_LOG_ITEMS = 60;
const IAMBIC_GAP_MS = DIT_MS;
const TONE_VOLUME = 1.0;
const TONE_FADE_MS = 12;
const TONE_FADE_STEPS = 6;

const normalizeRssi = (rssi) =>
  typeof rssi === 'number' ? rssi : -999;

const normalizeUuid = (uuid) => (uuid ? uuid.toLowerCase() : '');

const shortUuid = (uuid) => (uuid ? uuid.split('-')[0] : '');

const formatServiceUuids = (uuids) => {
  if (!uuids || uuids.length === 0) {
    return 'none';
  }
  return uuids.map(shortUuid).join(', ');
};

const sortDevices = (list) =>
  [...list].sort((a, b) => {
    if (a.isTarget !== b.isTarget) {
      return a.isTarget ? -1 : 1;
    }
    return normalizeRssi(b.rssi) - normalizeRssi(a.rssi);
  });

const withTimeout = (promise, timeoutMs, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

const nextElementForRequest = (lastElement, ditRequested, dahRequested) => {
  if (ditRequested && dahRequested) {
    if (!lastElement) {
      return 'dit';
    }
    return lastElement === 'dit' ? 'dah' : 'dit';
  }
  if (ditRequested) {
    return 'dit';
  }
  if (dahRequested) {
    return 'dah';
  }
  return null;
};

const formatBleState = (state) => {
  switch (state) {
    case 'on':
      return 'PoweredOn';
    case 'off':
      return 'PoweredOff';
    case 'unauthorized':
      return 'Unauthorized';
    case 'unsupported':
      return 'Unsupported';
    case 'resetting':
      return 'Resetting';
    case 'unknown':
      return 'Unknown';
    case 'turning_on':
      return 'TurningOn';
    case 'turning_off':
      return 'TurningOff';
    default:
      return state || 'Unknown';
  }
};

// Keyer modes
const KEYER_MODES = {
  STRAIGHT: 'straight',
  IAMBIC_A: 'iambic_a',
  IAMBIC_B: 'iambic_b',
};

const parseEvent = (value) => {
  if (!value) {
    return null;
  }

  let data;
  if (Array.isArray(value)) {
    data = Buffer.from(value);
  } else if (value instanceof Uint8Array) {
    data = Buffer.from(value);
  } else if (typeof value === 'string') {
    try {
      data = Buffer.from(value, 'base64');
    } catch (error) {
      return null;
    }
  } else {
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const text = data.toString('utf8').trim();
  if (!text) {
    return null;
  }

  // Parse new universal format: K1:1, K1:0, K2:1, K2:0
  // K1 = dit/left paddle, K2 = dah/right paddle
  // 1 = pressed, 0 = released
  const match = text.match(/^K([12]):([01])$/);
  if (match) {
    const key = parseInt(match[1]);
    const pressed = match[2] === '1';
    return {
      type: 'KEY_STATE',
      key: key,  // 1 or 2
      pressed: pressed,  // true or false
    };
  }

  // Legacy format support (for backwards compatibility)
  const upperText = text.toUpperCase();
  if (upperText.includes('DIT') && upperText.includes('DOWN')) {
    return {type: 'KEY_STATE', key: 1, pressed: true};
  }
  if (upperText.includes('DIT') && upperText.includes('UP')) {
    return {type: 'KEY_STATE', key: 1, pressed: false};
  }
  if (upperText.includes('DAH') && upperText.includes('DOWN')) {
    return {type: 'KEY_STATE', key: 2, pressed: true};
  }
  if (upperText.includes('DAH') && upperText.includes('UP')) {
    return {type: 'KEY_STATE', key: 2, pressed: false};
  }

  return {type: 'RAW', payload: text};
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const useTonePlayer = () => {
  const soundRef = useRef(null);
  const readyRef = useRef(false);
  const volumeRef = useRef(0);
  const fadeQueueRef = useRef(Promise.resolve());
  const playbackRef = useRef(false);
  const initTokenRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState(null);

  const teardownAudio = useCallback(async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    readyRef.current = false;
    playbackRef.current = false;
    volumeRef.current = 0;
    fadeQueueRef.current = Promise.resolve();
    setIsPlaying(false);
    setReady(false);
    if (sound) {
      try {
        await sound.stopAsync();
      } catch (error) {
        // Ignore
      }
      try {
        await sound.unloadAsync();
      } catch (error) {
        // Ignore
      }
    }
  }, []);

  const initAudio = useCallback(async () => {
    const token = initTokenRef.current + 1;
    initTokenRef.current = token;
    setStatus('configuring');
    setErrorMessage(null);
    await teardownAudio();
    try {
      await Audio.setIsEnabledAsync(true);
      const interruptionModeIOS =
        Audio.InterruptionModeIOS?.DoNotMix ?? 1;
      const interruptionModeAndroid =
        Audio.InterruptionModeAndroid?.DoNotMix ?? 1;
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        interruptionModeIOS,
        interruptionModeAndroid,
        shouldDuckAndroid: true,
      });

      setStatus('loading-tone');
      const {sound} = await Audio.Sound.createAsync(
        require('./assets/tone.wav'),
        {shouldPlay: true, isLooping: true, volume: 0}
      );
      if (token !== initTokenRef.current) {
        try {
          await sound.unloadAsync();
        } catch (error) {
          // Ignore
        }
        return;
      }
      soundRef.current = sound;
      readyRef.current = true;
      setReady(true);
      setStatus('ready');
    } catch (error) {
      const message = error?.message ? error.message : String(error);
      console.error('Failed to initialize audio:', error);
      setStatus('error');
      setErrorMessage(message);
      setReady(false);
    }
  }, []);

  useEffect(() => {
    initAudio();

    return () => {
      teardownAudio();
    };
  }, [initAudio, teardownAudio]);

  const ensurePlayback = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound || !readyRef.current) {
      return;
    }
    try {
      if (!playbackRef.current) {
        await sound.setIsLoopingAsync(true);
        await sound.playAsync();
        playbackRef.current = true;
      }
    } catch (error) {
      // Ignore
    }
  }, []);

  const rampVolume = useCallback(
    async (targetVolume, durationMs) => {
      const sound = soundRef.current;
      if (!sound || !readyRef.current) {
        return;
      }
      const startVolume = volumeRef.current;
      const steps = Math.max(1, TONE_FADE_STEPS);
      const stepMs = durationMs / steps;
      for (let i = 1; i <= steps; i += 1) {
        const nextVolume =
          startVolume + ((targetVolume - startVolume) * i) / steps;
        try {
          await sound.setVolumeAsync(nextVolume);
          volumeRef.current = nextVolume;
        } catch (error) {
          break;
        }
        await sleep(stepMs);
      }
    },
    []
  );

  const gateOn = useCallback(async () => {
    if (!readyRef.current) {
      return;
    }
    await ensurePlayback();
    fadeQueueRef.current = fadeQueueRef.current
      .then(() => rampVolume(TONE_VOLUME, TONE_FADE_MS))
      .catch(() => rampVolume(TONE_VOLUME, TONE_FADE_MS));
    setIsPlaying(true);
  }, [ensurePlayback, rampVolume]);

  const gateOff = useCallback(async () => {
    if (!readyRef.current) {
      return;
    }
    fadeQueueRef.current = fadeQueueRef.current
      .then(() => rampVolume(0, TONE_FADE_MS))
      .catch(() => rampVolume(0, TONE_FADE_MS));
    setIsPlaying(false);
  }, [rampVolume]);

  const stop = useCallback(async () => {
    await gateOff();
  }, [gateOff]);

  const playElement = useCallback(
    async (durationMs) => {
      await gateOn();
      await sleep(durationMs);
      await gateOff();
    },
    [gateOn, gateOff]
  );

  return {
    ready,
    isPlaying,
    gateOn,
    gateOff,
    playElement,
    stop,
    status,
    errorMessage,
    retry: initAudio,
  };
};

export default function App() {
  const scanStopReasonRef = useRef(null);
  const devicesByIdRef = useRef(new Map());
  const scanFilterRef = useRef(SCAN_FILTERS.SERVICE);
  const connectedDeviceRef = useRef(null);
  const handleEventRef = useRef(null);
  const keyStateRef = useRef({key1: false, key2: false});
  const keyerRef = useRef({
    running: false,
    token: 0,
    lastElement: null,
    ditMemory: false,
    dahMemory: false,
  });
  const [devices, setDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanFilter, setScanFilter] = useState(SCAN_FILTERS.SERVICE);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [logs, setLogs] = useState([]);
  const [keyerMode, setKeyerMode] = useState(KEYER_MODES.STRAIGHT);
  const keyerModeRef = useRef(keyerMode);
  const [bleState, setBleState] = useState('unknown');
  const {
    ready: toneReady,
    isPlaying,
    gateOn,
    gateOff,
    playElement,
    stop,
    status: audioStatus,
    errorMessage: audioError,
    retry: retryAudio,
  } = useTonePlayer();

  const addLog = useCallback((message) => {
    const timestamp = new Date().toLocaleTimeString();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text: `${timestamp} ${message}`,
    };
    setLogs((prev) => [entry, ...prev].slice(0, MAX_LOG_ITEMS));
  }, []);

  const requestBlePermissions = useCallback(async () => {
    if (Platform.OS !== 'android') {
      return true;
    }

    if (Platform.Version < 31) {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }

    const permissions = [
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ];

    const results = await PermissionsAndroid.requestMultiple(permissions);
    return permissions.every(
      (permission) => results[permission] === PermissionsAndroid.RESULTS.GRANTED
    );
  }, []);

  const stopScan = useCallback(() => {
    scanStopReasonRef.current = 'manual';
    BleManager.stopScan().catch(() => {});
  }, []);

  const startScan = useCallback(async () => {
    const ok = await requestBlePermissions();
    if (!ok) {
      addLog('Bluetooth permissions denied.');
      return;
    }

    try {
      const started = await BleManager.isStarted();
      if (!started) {
        await BleManager.start({showAlert: false});
      }
    } catch (error) {
      addLog(`BLE init failed: ${error.message || error}`);
    }

    // Check BLE state
    let state = 'unknown';
    try {
      state = await BleManager.checkState();
    } catch (error) {
      addLog(`BLE state check failed: ${error.message || error}`);
    }
    addLog(`BLE State: ${state}`);
    setBleState(state);

    if (state !== 'on') {
      if (state === 'unauthorized') {
        addLog('Bluetooth permission not granted. Enable it in Settings.');
      } else if (state === 'unsupported') {
        addLog('Bluetooth is not supported on this device.');
      } else if (state === 'off') {
        addLog('Bluetooth is off. Please enable it in Settings.');
      } else {
        addLog('Bluetooth is not ready yet. Please try again.');
      }
      return;
    }

    devicesByIdRef.current.clear();
    setDevices([]);
    setScanning(true);

    const scanServiceUuids =
      scanFilter === SCAN_FILTERS.SERVICE ? SCAN_SERVICE_UUIDS : [];

    addLog(
      scanFilter === SCAN_FILTERS.SERVICE
        ? `Scan started (filter: NUS ${shortUuid(SERVICE_UUID)}...)`
        : 'Scan started (all devices)...'
    );
    scanStopReasonRef.current = null;

    try {
      await BleManager.scan({
        serviceUUIDs: scanServiceUuids,
        seconds: SCAN_TIMEOUT_S,
        allowDuplicates: true,
      });
    } catch (error) {
      setScanning(false);
      addLog(`Scan error: ${error.message || error}`);
    }
  }, [addLog, requestBlePermissions, scanFilter]);

  const handleDiscoverPeripheral = useCallback(
    (peripheral) => {
      if (!peripheral) {
        addLog('Received null peripheral from scan');
        return;
      }

      const name =
        peripheral.name ||
        peripheral.advertising?.localName ||
        'Unnamed device';
      const serviceUUIDs = (peripheral.advertising?.serviceUUIDs || []).map(
        normalizeUuid
      );
      const entry = {
        id: peripheral.id,
        name,
        rssi: peripheral.rssi ?? null,
        serviceUUIDs,
        isTarget:
          name.startsWith(DEVICE_NAME_PREFIX) ||
          serviceUUIDs.includes(SERVICE_UUID),
      };

      const existing = devicesByIdRef.current.get(entry.id);
      const nameUpgraded =
        existing &&
        existing.name === 'Unnamed device' &&
        entry.name !== 'Unnamed device';
      if (!existing || nameUpgraded) {
        const rssiLabel = entry.rssi !== null ? entry.rssi : 'n/a';
        addLog(
          `Found: ${entry.name} (${entry.id.slice(0, 8)}..., RSSI ${rssiLabel}, services ${formatServiceUuids(
            entry.serviceUUIDs
          )})`
        );
      }

      devicesByIdRef.current.set(entry.id, entry);
      setDevices((prev) => {
        const index = prev.findIndex((item) => item.id === entry.id);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = {...updated[index], ...entry};
          return sortDevices(updated);
        }
        return sortDevices([...prev, entry]);
      });
    },
    [addLog]
  );

  const resetKeyer = useCallback(
    async (stopTone = true) => {
      keyerRef.current.running = false;
      keyerRef.current.token += 1;
      keyerRef.current.lastElement = null;
      keyerRef.current.ditMemory = false;
      keyerRef.current.dahMemory = false;
      if (stopTone) {
        await gateOff();
      }
    },
    [gateOff]
  );

  const startIambicLoop = useCallback(async () => {
    if (keyerRef.current.running) {
      return;
    }
    keyerRef.current.running = true;
    keyerRef.current.token += 1;
    const token = keyerRef.current.token;

    while (keyerRef.current.running && token === keyerRef.current.token) {
      const key1 = keyStateRef.current.key1;
      const key2 = keyStateRef.current.key2;
      const ditRequested = key1 || keyerRef.current.ditMemory;
      const dahRequested = key2 || keyerRef.current.dahMemory;
      const nextElement = nextElementForRequest(
        keyerRef.current.lastElement,
        ditRequested,
        dahRequested
      );

      if (!nextElement) {
        keyerRef.current.running = false;
        await gateOff();
        break;
      }

      if (nextElement === 'dit') {
        keyerRef.current.ditMemory = false;
      } else {
        keyerRef.current.dahMemory = false;
      }
      keyerRef.current.lastElement = nextElement;

      await playElement(nextElement === 'dit' ? DIT_MS : DAH_MS);
      if (token !== keyerRef.current.token) {
        break;
      }

      const key1After = keyStateRef.current.key1;
      const key2After = keyStateRef.current.key2;
      if (
        !key1After &&
        !key2After &&
        keyerModeRef.current === KEYER_MODES.IAMBIC_A
      ) {
        keyerRef.current.ditMemory = false;
        keyerRef.current.dahMemory = false;
      }

      await sleep(IAMBIC_GAP_MS);
    }
  }, [gateOff, playElement]);

  const handleEvent = useCallback(
    (event) => {
      if (!event || event.type !== 'KEY_STATE') {
        return;
      }

      const {key, pressed} = event;
      if (key === 1) {
        keyStateRef.current.key1 = pressed;
        if (pressed) {
          keyerRef.current.ditMemory = true;
        }
      } else if (key === 2) {
        keyStateRef.current.key2 = pressed;
        if (pressed) {
          keyerRef.current.dahMemory = true;
        }
      }

      if (keyerModeRef.current === KEYER_MODES.STRAIGHT) {
        if (keyStateRef.current.key1 || keyStateRef.current.key2) {
          gateOn();
        } else {
          gateOff();
        }
        return;
      }

      if (
        keyerModeRef.current === KEYER_MODES.IAMBIC_A ||
        keyerModeRef.current === KEYER_MODES.IAMBIC_B
      ) {
        startIambicLoop();
      }
    },
    [gateOff, gateOn, startIambicLoop]
  );

  useEffect(() => {
    scanFilterRef.current = scanFilter;
  }, [scanFilter]);

  useEffect(() => {
    connectedDeviceRef.current = connectedDevice;
  }, [connectedDevice]);

  useEffect(() => {
    handleEventRef.current = handleEvent;
  }, [handleEvent]);

  useEffect(() => {
    keyerModeRef.current = keyerMode;
    if (keyerMode === KEYER_MODES.STRAIGHT) {
      resetKeyer(false);
      if (keyStateRef.current.key1 || keyStateRef.current.key2) {
        gateOn();
      } else {
        gateOff();
      }
    } else {
      resetKeyer(true);
      if (keyStateRef.current.key1 || keyStateRef.current.key2) {
        startIambicLoop();
      }
    }
  }, [gateOff, gateOn, keyerMode, resetKeyer, startIambicLoop]);

  const connectToDevice = useCallback(
    async (device) => {
      if (!device?.id) {
        return;
      }

      stopScan();
      addLog(`Connecting to ${device.name || device.id}...`);

      try {
        await withTimeout(
          BleManager.connect(device.id),
          12000,
          'Connect'
        );
        addLog('Connected. Discovering services...');
        await withTimeout(
          BleManager.retrieveServices(device.id),
          8000,
          'Service discovery'
        );
        addLog('Enabling notifications...');
        await withTimeout(
          BleManager.startNotification(device.id, SERVICE_UUID, CHAR_UUID_TX),
          8000,
          'Start notification'
        );
        setConnectedDevice(device);
        addLog('Connected. Listening for key events.');
      } catch (error) {
        addLog(`Connect error: ${error.message || error}`);
        setConnectedDevice(null);
      }
    },
    [addLog, stopScan]
  );

  const disconnect = useCallback(async () => {
    if (!connectedDevice) {
      return;
    }

    try {
      await BleManager.disconnect(connectedDevice.id);
    } catch (error) {
      addLog(`Disconnect error: ${error.message || error}`);
    }

    keyStateRef.current = {key1: false, key2: false};
    resetKeyer();
    stop();
    setConnectedDevice(null);
    addLog('Disconnected.');
  }, [addLog, connectedDevice, resetKeyer, stop]);

  useEffect(() => {
    BleManager.start({showAlert: false}).catch((error) => {
      addLog(`BLE init failed: ${error.message || error}`);
    });

    const subscriptions = [
      BleManager.onDidUpdateState(({state}) => {
        addLog(`BLE state changed: ${state}`);
        setBleState(state);

        if (state === 'on') {
          addLog('Bluetooth is ready. You can now scan for devices.');
        } else if (state === 'unauthorized') {
          addLog('Bluetooth permission not granted. Enable it in Settings.');
        } else if (state === 'unsupported') {
          addLog('Bluetooth is not supported on this device.');
        }
      }),
      BleManager.onStopScan(() => {
        setScanning(false);
        if (scanStopReasonRef.current === 'manual') {
          addLog('Scan stopped.');
        } else {
          addLog('Scan completed.');
        }
        scanStopReasonRef.current = null;
        if (
          devicesByIdRef.current.size === 0 &&
          scanFilterRef.current === SCAN_FILTERS.SERVICE
        ) {
          addLog('No NUS devices found. Try switching Scan Filter to All.');
        }
      }),
      BleManager.onDiscoverPeripheral(handleDiscoverPeripheral),
      BleManager.onDidUpdateValueForCharacteristic((data) => {
        if (!data || data.value == null) {
          return;
        }

        const event = parseEvent(data.value);
        if (event) {
          if (event.type === 'RAW') {
            addLog(`RX ${event.payload}`);
          } else if (event.type === 'KEY_STATE') {
            const keyName = event.key === 1 ? 'K1' : 'K2';
            const state = event.pressed ? 'DOWN' : 'UP';
            addLog(`${keyName} ${state}`);
          }
          handleEventRef.current?.(event);
        }
      }),
      BleManager.onDisconnectPeripheral(({peripheral}) => {
        const current = connectedDeviceRef.current;
        if (current && current.id === peripheral) {
          addLog('Disconnected.');
          keyStateRef.current = {key1: false, key2: false};
          resetKeyer();
          stop();
          setConnectedDevice(null);
        }
      }),
    ];

    BleManager.checkState()
      .then((state) => setBleState(state))
      .catch(() => {});

    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, [addLog, handleDiscoverPeripheral, resetKeyer, stop]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>MorseForge Keylink</Text>
        <Text style={styles.subtitle}>
          Bluetooth Morse key audio monitor
        </Text>
      </View>

      <View style={styles.statusRow}>
        <View style={styles.statusBlock}>
          <Text style={styles.label}>BLE</Text>
          <Text style={styles.value}>{formatBleState(bleState)}</Text>
        </View>
        <View style={styles.statusBlock}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>
            {connectedDevice
              ? `Connected to ${
                  connectedDevice.name || connectedDevice.localName || 'device'
                }`
              : scanning
              ? 'Scanning...'
              : 'Idle'}
          </Text>
        </View>
        <View style={styles.statusBlock}>
          <Text style={styles.label}>Audio</Text>
          <Text style={styles.value}>
            {toneReady
              ? isPlaying
                ? 'Playing'
                : 'Ready'
              : audioError
              ? 'Error'
              : `Loading... (${audioStatus})`}
          </Text>
          {audioError && (
            <Text style={styles.errorText} numberOfLines={2}>
              {audioError}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.modeSelector}>
        <Text style={styles.label}>Keyer Mode</Text>
        <View style={styles.modeButtons}>
          <Pressable
            style={[
              styles.modeButton,
              keyerMode === KEYER_MODES.STRAIGHT && styles.modeButtonActive,
            ]}
            onPress={() => setKeyerMode(KEYER_MODES.STRAIGHT)}
          >
            <Text
              style={[
                styles.modeButtonText,
                keyerMode === KEYER_MODES.STRAIGHT &&
                  styles.modeButtonTextActive,
              ]}
            >
              Straight
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.modeButton,
              keyerMode === KEYER_MODES.IAMBIC_A && styles.modeButtonActive,
            ]}
            onPress={() => setKeyerMode(KEYER_MODES.IAMBIC_A)}
          >
            <Text
              style={[
                styles.modeButtonText,
                keyerMode === KEYER_MODES.IAMBIC_A &&
                  styles.modeButtonTextActive,
              ]}
            >
              Iambic A
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.modeButton,
              keyerMode === KEYER_MODES.IAMBIC_B && styles.modeButtonActive,
            ]}
            onPress={() => setKeyerMode(KEYER_MODES.IAMBIC_B)}
          >
            <Text
              style={[
                styles.modeButtonText,
                keyerMode === KEYER_MODES.IAMBIC_B &&
                  styles.modeButtonTextActive,
              ]}
            >
              Iambic B
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={[styles.button, scanning && styles.buttonDisabled]}
          onPress={startScan}
          disabled={scanning}
        >
          <Text style={styles.buttonText}>Scan</Text>
        </Pressable>
        <Pressable
          style={[styles.button, !scanning && styles.buttonDisabled]}
          onPress={stopScan}
          disabled={!scanning}
        >
          <Text style={styles.buttonText}>Stop</Text>
        </Pressable>
        <Pressable
          style={[
            styles.button,
            !connectedDevice && styles.buttonDisabled,
            styles.disconnectButton,
          ]}
          onPress={disconnect}
          disabled={!connectedDevice}
        >
          <Text style={styles.buttonText}>Disconnect</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.retryButton]}
          onPress={retryAudio}
        >
          <Text style={styles.buttonText}>Retry Audio</Text>
        </Pressable>
      </View>

      <View style={styles.scanSelector}>
        <Text style={styles.label}>Scan Filter</Text>
        <View style={styles.modeButtons}>
          <Pressable
            style={[
              styles.modeButton,
              scanFilter === SCAN_FILTERS.SERVICE && styles.modeButtonActive,
              scanning && styles.buttonDisabled,
            ]}
            onPress={() => setScanFilter(SCAN_FILTERS.SERVICE)}
            disabled={scanning}
          >
            <Text
              style={[
                styles.modeButtonText,
                scanFilter === SCAN_FILTERS.SERVICE &&
                  styles.modeButtonTextActive,
              ]}
            >
              NUS
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.modeButton,
              scanFilter === SCAN_FILTERS.ALL && styles.modeButtonActive,
              scanning && styles.buttonDisabled,
            ]}
            onPress={() => setScanFilter(SCAN_FILTERS.ALL)}
            disabled={scanning}
          >
            <Text
              style={[
                styles.modeButtonText,
                scanFilter === SCAN_FILTERS.ALL && styles.modeButtonTextActive,
              ]}
            >
              All
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Nearby Devices</Text>
        <FlatList
          data={devices}
          keyExtractor={(item) => item.id}
          renderItem={({item}) => (
            <Pressable
              style={styles.deviceRow}
              onPress={() => connectToDevice(item)}
            >
              <View style={styles.deviceInfo}>
                <View style={styles.deviceNameRow}>
                  <Text style={styles.deviceName}>{item.name}</Text>
                  {item.isTarget && (
                    <Text style={styles.deviceTag}>TARGET</Text>
                  )}
                </View>
                <Text style={styles.deviceMeta}>
                  RSSI: {item.rssi ?? 'n/a'} | Services:{' '}
                  {formatServiceUuids(item.serviceUUIDs)}
                </Text>
                <Text style={styles.deviceId}>{item.id}</Text>
              </View>
              <Text style={styles.deviceAction}>Connect</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {scanning
                ? scanFilter === SCAN_FILTERS.SERVICE
                  ? 'Searching for MorseKey devices (NUS)...'
                  : 'Searching for nearby BLE devices...'
                : 'No devices found yet.'}
            </Text>
          }
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Key Events</Text>
        <FlatList
          data={logs}
          keyExtractor={(item) => item.id}
          renderItem={({item}) => (
            <Text style={styles.logLine}>{item.text}</Text>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No events received yet.</Text>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1115',
    padding: 16,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statusBlock: {
    flex: 1,
    backgroundColor: '#1a1f2b',
    padding: 12,
    borderRadius: 10,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 11,
    marginTop: 6,
  },
  label: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 4,
  },
  value: {
    color: '#e2e8f0',
    fontSize: 13,
  },
  modeSelector: {
    backgroundColor: '#1a1f2b',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  scanSelector: {
    backgroundColor: '#1a1f2b',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  modeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  modeButton: {
    flex: 1,
    backgroundColor: '#111827',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: '#2563eb',
    borderColor: '#3b82f6',
  },
  modeButtonText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: '#f8fafc',
  },
  controls: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  button: {
    flex: 1,
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  disconnectButton: {
    backgroundColor: '#ef4444',
  },
  retryButton: {
    backgroundColor: '#0f766e',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#f8fafc',
    fontWeight: '600',
  },
  section: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#f1f5f9',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  deviceRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  deviceInfo: {
    flex: 1,
    paddingRight: 10,
  },
  deviceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deviceName: {
    color: '#e2e8f0',
    fontSize: 14,
  },
  deviceTag: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '700',
  },
  deviceMeta: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  deviceId: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
  },
  deviceAction: {
    color: '#38bdf8',
    fontWeight: '600',
  },
  emptyText: {
    color: '#64748b',
    fontSize: 12,
    paddingVertical: 8,
  },
  logLine: {
    color: '#cbd5f5',
    fontSize: 12,
    paddingVertical: 2,
  },
});
