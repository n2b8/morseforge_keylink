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
import Sound from 'react-native-sound';
import {Buffer} from 'buffer';

global.Buffer = global.Buffer || Buffer;

const SERVICE_UUID = '0000f00d-1212-efde-1523-785feabcd123';
const CHAR_UUID = '0000f00e-1212-efde-1523-785feabcd123';
const SCAN_SERVICE_UUIDS = null;
const DEVICE_NAME_PREFIX = 'Morse';

const DIT_MS = 60;
const DAH_MS = 180;
const MAX_LOG_ITEMS = 60;

const CODE_MAP = {
  1: 'DIT_DOWN',
  2: 'DIT_UP',
  3: 'DAH_DOWN',
  4: 'DAH_UP',
  5: 'DIT',
  6: 'DAH',
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

  if (data.length === 1) {
    const mapped = CODE_MAP[data[0]];
    if (mapped) {
      return {type: mapped};
    }
  }

  const text = data.toString('utf8').trim().toUpperCase();
  if (!text) {
    return null;
  }

  if (text === '.' || text === 'DIT') {
    return {type: 'DIT'};
  }
  if (text === '-' || text === 'DAH') {
    return {type: 'DAH'};
  }
  if (text.includes('DIT') && text.includes('DOWN')) {
    return {type: 'DIT_DOWN'};
  }
  if (text.includes('DIT') && text.includes('UP')) {
    return {type: 'DIT_UP'};
  }
  if (text.includes('DAH') && text.includes('DOWN')) {
    return {type: 'DAH_DOWN'};
  }
  if (text.includes('DAH') && text.includes('UP')) {
    return {type: 'DAH_UP'};
  }
  if (text.includes('DIT')) {
    return {type: 'DIT'};
  }
  if (text.includes('DAH')) {
    return {type: 'DAH'};
  }

  return {type: 'RAW', payload: text};
};

const useTonePlayer = () => {
  const toneRef = useRef(null);
  const timeoutRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    Sound.setCategory('Playback');
    const tone = new Sound('tone.wav', Sound.MAIN_BUNDLE, (error) => {
      setReady(!error);
    });
    tone.setVolume(1.0);
    toneRef.current = tone;

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      tone.release();
    };
  }, []);

  const stop = useCallback(() => {
    const tone = toneRef.current;
    if (!tone) {
      return;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    tone.stop(() => setIsPlaying(false));
  }, []);

  const playContinuous = useCallback(() => {
    const tone = toneRef.current;
    if (!tone || !ready) {
      return;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    tone.stop(() => {
      tone.setNumberOfLoops(-1);
      tone.play((success) => {
        if (!success) {
          setIsPlaying(false);
        }
      });
      setIsPlaying(true);
    });
  }, [ready]);

  const playOneShot = useCallback(
    (durationMs) => {
      const tone = toneRef.current;
      if (!tone || !ready) {
        return;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      tone.stop(() => {
        tone.setNumberOfLoops(0);
        tone.play((success) => {
          if (!success) {
            setIsPlaying(false);
          }
        });
        setIsPlaying(true);
        timeoutRef.current = setTimeout(() => {
          tone.stop(() => setIsPlaying(false));
          timeoutRef.current = null;
        }, durationMs);
      });
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

      switch (event.type) {
        case 'DIT_DOWN':
        case 'DAH_DOWN':
          playContinuous();
          break;
        case 'DIT_UP':
        case 'DAH_UP':
          stop();
          break;
        case 'DIT':
          playOneShot(DIT_MS);
          break;
        case 'DAH':
          playOneShot(DAH_MS);
          break;
        default:
          break;
      }
    },
    [playContinuous, playOneShot, stop]
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
          CHAR_UUID,
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
              addLog(
                event.type === 'RAW'
                  ? `RX ${event.payload}`
                  : `RX ${event.type}`
              );
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
            {toneReady ? (isPlaying ? 'Playing' : 'Ready') : 'Missing tone.wav'}
          </Text>
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
                ? 'Searching for MorseForge devices...'
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
