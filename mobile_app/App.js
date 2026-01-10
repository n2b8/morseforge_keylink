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
import {BleManager} from 'react-native-ble-plx';
import {Audio} from 'expo-av';
import {Buffer} from 'buffer';

global.Buffer = global.Buffer || Buffer;

// BLE UART Service (Nordic UART Service standard UUIDs)
const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const CHAR_UUID_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';  // Notifications from device
const SCAN_SERVICE_UUIDS = null;
const DEVICE_NAME_PREFIX = 'MorseKey';

const DIT_MS = 60;
const DAH_MS = 180;
const MAX_LOG_ITEMS = 60;

// Keyer modes
const KEYER_MODES = {
  STRAIGHT: 'straight',
  IAMBIC_A: 'iambic_a',
  IAMBIC_B: 'iambic_b',
};

const parseEvent = (base64Value) => {
  if (!base64Value) {
    return null;
  }

  let data;
  try {
    data = Buffer.from(base64Value, 'base64');
  } catch (error) {
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

const useTonePlayer = () => {
  const soundRef = useRef(null);
  const timeoutRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const initAudio = async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
        });

        // Generate a simple tone programmatically (440Hz sine wave)
        const {sound} = await Audio.Sound.createAsync(
          require('./assets/tone.wav'),
          {shouldPlay: false, isLooping: false}
        );
        soundRef.current = sound;
        setReady(true);
      } catch (error) {
        console.error('Failed to initialize audio:', error);
        setReady(false);
      }
    };

    initAudio();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const stop = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) {
      return;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try {
      await sound.stopAsync();
      setIsPlaying(false);
    } catch (error) {
      // Ignore
    }
  }, []);

  const playContinuous = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound || !ready) {
      return;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try {
      await sound.stopAsync();
      await sound.setPositionAsync(0);
      await sound.setIsLoopingAsync(true);
      await sound.playAsync();
      setIsPlaying(true);
    } catch (error) {
      setIsPlaying(false);
    }
  }, [ready]);

  const playOneShot = useCallback(
    async (durationMs) => {
      const sound = soundRef.current;
      if (!sound || !ready) {
        return;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      try {
        await sound.stopAsync();
        await sound.setPositionAsync(0);
        await sound.setIsLoopingAsync(false);
        await sound.playAsync();
        setIsPlaying(true);
        timeoutRef.current = setTimeout(async () => {
          await sound.stopAsync();
          setIsPlaying(false);
          timeoutRef.current = null;
        }, durationMs);
      } catch (error) {
        setIsPlaying(false);
      }
    },
    [ready]
  );

  return {ready, isPlaying, playContinuous, playOneShot, stop};
};

export default function App() {
  const managerRef = useRef(new BleManager());
  const monitorRef = useRef(null);
  const [devices, setDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [logs, setLogs] = useState([]);
  const [keyerMode, setKeyerMode] = useState(KEYER_MODES.STRAIGHT);
  const [key1Pressed, setKey1Pressed] = useState(false);
  const [key2Pressed, setKey2Pressed] = useState(false);
  const iambicStateRef = useRef({lastKey: null, needsAlternate: false});
  const {ready: toneReady, isPlaying, playContinuous, playOneShot, stop} =
    useTonePlayer();

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
    managerRef.current.stopDeviceScan();
    setScanning(false);
  }, []);

  const startScan = useCallback(async () => {
    const ok = await requestBlePermissions();
    if (!ok) {
      addLog('Bluetooth permissions denied.');
      return;
    }

    setDevices([]);
    setScanning(true);
    addLog('Scanning for devices...');

    managerRef.current.startDeviceScan(
      SCAN_SERVICE_UUIDS,
      null,
      (error, device) => {
        if (error) {
          addLog(`Scan error: ${error.message}`);
          setScanning(false);
          return;
        }

        if (!device) {
          return;
        }

        const name = device.name || device.localName || 'Unnamed device';
        if (DEVICE_NAME_PREFIX) {
          const prefix = DEVICE_NAME_PREFIX.toLowerCase();
          if (!name.toLowerCase().startsWith(prefix)) {
            return;
          }
        }

        setDevices((prev) => {
          if (prev.some((item) => item.id === device.id)) {
            return prev;
          }
          return [...prev, {id: device.id, name}];
        });
      }
    );
  }, [addLog, requestBlePermissions]);

  const handleEvent = useCallback(
    (event) => {
      if (!event) {
        return;
      }

      if (event.type === 'KEY_STATE') {
        const {key, pressed} = event;

        // Update key state
        if (key === 1) {
          setKey1Pressed(pressed);
        } else if (key === 2) {
          setKey2Pressed(pressed);
        }

        // Handle based on keyer mode
        if (keyerMode === KEYER_MODES.STRAIGHT) {
          // Straight key mode: either key acts as a straight key
          if (pressed) {
            playContinuous();
          } else {
            // Only stop if both keys are released
            if (key === 1 && !key2Pressed) {
              stop();
            } else if (key === 2 && !key1Pressed) {
              stop();
            }
          }
        } else if (keyerMode === KEYER_MODES.IAMBIC_A || keyerMode === KEYER_MODES.IAMBIC_B) {
          // Iambic mode: K1 = dit, K2 = dah
          if (pressed) {
            if (key === 1) {
              // Dit paddle pressed
              playOneShot(DIT_MS);
              iambicStateRef.current.lastKey = 1;
            } else {
              // Dah paddle pressed
              playOneShot(DAH_MS);
              iambicStateRef.current.lastKey = 2;
            }
          } else {
            // Key released
            // In iambic mode, check if other paddle is still pressed
            if (key === 1 && key2Pressed) {
              // Dit released, dah still pressed - play dah
              playOneShot(DAH_MS);
            } else if (key === 2 && key1Pressed) {
              // Dah released, dit still pressed - play dit
              playOneShot(DIT_MS);
            }
          }
        }
      }
    },
    [keyerMode, key1Pressed, key2Pressed, playContinuous, playOneShot, stop]
  );

  const connectToDevice = useCallback(
    async (device) => {
      if (!device?.id) {
        return;
      }

      stopScan();
      addLog(`Connecting to ${device.name || device.id}...`);

      try {
        const connected = await managerRef.current.connectToDevice(device.id);
        await connected.discoverAllServicesAndCharacteristics();
        setConnectedDevice(connected);
        addLog('Connected. Listening for key events.');

        monitorRef.current?.remove();
        monitorRef.current = connected.monitorCharacteristicForService(
          SERVICE_UUID,
          CHAR_UUID_TX,
          (error, characteristic) => {
            if (error) {
              addLog(`Notify error: ${error.message}`);
              return;
            }

            if (!characteristic?.value) {
              return;
            }

            const event = parseEvent(characteristic.value);
            if (event) {
              if (event.type === 'RAW') {
                addLog(`RX ${event.payload}`);
              } else if (event.type === 'KEY_STATE') {
                const keyName = event.key === 1 ? 'K1' : 'K2';
                const state = event.pressed ? 'DOWN' : 'UP';
                addLog(`${keyName} ${state}`);
              }
              handleEvent(event);
            }
          }
        );

        connected.onDisconnected((error) => {
          if (error) {
            addLog(`Disconnected: ${error.message}`);
          } else {
            addLog('Disconnected.');
          }
          stop();
          setConnectedDevice(null);
        });
      } catch (error) {
        addLog(`Connect error: ${error.message || error}`);
        setConnectedDevice(null);
      }
    },
    [addLog, handleEvent, stop, stopScan]
  );

  const disconnect = useCallback(async () => {
    if (!connectedDevice) {
      return;
    }

    try {
      monitorRef.current?.remove();
      monitorRef.current = null;
      await connectedDevice.cancelConnection();
    } catch (error) {
      addLog(`Disconnect error: ${error.message || error}`);
    }

    stop();
    setConnectedDevice(null);
    addLog('Disconnected.');
  }, [addLog, connectedDevice, stop]);

  useEffect(() => {
    return () => {
      monitorRef.current?.remove();
      managerRef.current.destroy();
    };
  }, []);

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
            {toneReady ? (isPlaying ? 'Playing' : 'Ready') : 'Loading...'}
          </Text>
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
              <View>
                <Text style={styles.deviceName}>{item.name}</Text>
                <Text style={styles.deviceId}>{item.id}</Text>
              </View>
              <Text style={styles.deviceAction}>Connect</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {scanning
                ? 'Searching for MorseKey devices...'
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
    alignItems: 'center',
  },
  deviceName: {
    color: '#e2e8f0',
    fontSize: 14,
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
