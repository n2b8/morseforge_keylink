import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
} from 'react-native';
import {Audio} from 'expo-av';
import {KeyboardExtendedBaseView} from 'react-native-external-keyboard';

const DIT_MS = 60;
const DAH_MS = 180;
const MAX_LOG_ITEMS = 60;
const IAMBIC_GAP_MS = DIT_MS;
const TONE_VOLUME = 1.0;
const TONE_FADE_MS = 12;
const TONE_FADE_STEPS = 6;

const LEFT_BRACKET_KEYCODES = new Set([47, 71]);
const RIGHT_BRACKET_KEYCODES = new Set([48, 72]);

const KEYER_MODES = {
  STRAIGHT: 'straight',
  IAMBIC_A: 'iambic_a',
  IAMBIC_B: 'iambic_b',
};

const resolveKeyFromEvent = (event) => {
  const data = event?.nativeEvent || event;
  if (!data) {
    return null;
  }

  const {
    keyCode,
    unicode,
    unicodeChar,
    isCtrlPressed,
    isAltPressed,
    isShiftPressed,
  } = data;

  if (!isCtrlPressed || isAltPressed || isShiftPressed) {
    return null;
  }

  if (
    unicodeChar === '[' ||
    unicode === 91 ||
    LEFT_BRACKET_KEYCODES.has(keyCode)
  ) {
    return 1;
  }

  if (
    unicodeChar === ']' ||
    unicode === 93 ||
    RIGHT_BRACKET_KEYCODES.has(keyCode)
  ) {
    return 2;
  }

  return null;
};

const describeKey = (key) => (key === 1 ? 'K1' : 'K2');
const describeCombo = (key) => (key === 1 ? 'Ctrl+[' : 'Ctrl+]');

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
  }, [teardownAudio]);

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

  const rampVolume = useCallback(async (targetVolume, durationMs) => {
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
  }, []);

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
  const keyboardRef = useRef(null);
  const handleKeyStateRef = useRef(null);
  const keyStateRef = useRef({key1: false, key2: false});
  const keyerRef = useRef({
    running: false,
    token: 0,
    lastElement: null,
    ditMemory: false,
    dahMemory: false,
  });

  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const [logs, setLogs] = useState([]);
  const [keyerMode, setKeyerMode] = useState(KEYER_MODES.STRAIGHT);
  const keyerModeRef = useRef(keyerMode);
  const [lastInput, setLastInput] = useState(null);

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

  const logKeyEvent = useCallback(
    (key, pressed) => {
      const keyName = describeKey(key);
      const state = pressed ? 'DOWN' : 'UP';
      const combo = describeCombo(key);
      setLastInput({keyName, state, combo});
      addLog(`${keyName} ${state} (${combo})`);
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
      const nextElement = (() => {
        if (ditRequested && dahRequested) {
          if (!keyerRef.current.lastElement) {
            return 'dit';
          }
          return keyerRef.current.lastElement === 'dit' ? 'dah' : 'dit';
        }
        if (ditRequested) {
          return 'dit';
        }
        if (dahRequested) {
          return 'dah';
        }
        return null;
      })();

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

  const handleKeyState = useCallback(
    (key, pressed) => {
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

  const handleKeyboardDown = useCallback(
    (event) => {
      const key = resolveKeyFromEvent(event);
      if (!key) {
        return;
      }
      if (key === 1 && keyStateRef.current.key1) {
        return;
      }
      if (key === 2 && keyStateRef.current.key2) {
        return;
      }
      logKeyEvent(key, true);
      handleKeyStateRef.current?.(key, true);
    },
    [logKeyEvent]
  );

  const handleKeyboardUp = useCallback(
    (event) => {
      const key = resolveKeyFromEvent(event);
      if (!key) {
        return;
      }
      if (key === 1 && !keyStateRef.current.key1) {
        return;
      }
      if (key === 2 && !keyStateRef.current.key2) {
        return;
      }
      logKeyEvent(key, false);
      handleKeyStateRef.current?.(key, false);
    },
    [logKeyEvent]
  );

  const focusKeyboard = useCallback(() => {
    keyboardRef.current?.focus?.();
  }, []);

  const resetSession = useCallback(async () => {
    keyStateRef.current = {key1: false, key2: false};
    setLastInput(null);
    await resetKeyer();
    await stop();
    addLog('Keyer reset.');
  }, [addLog, resetKeyer, stop]);

  useEffect(() => {
    handleKeyStateRef.current = handleKeyState;
  }, [handleKeyState]);

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

  return (
    <KeyboardExtendedBaseView
      ref={keyboardRef}
      style={styles.keyboardRoot}
      autoFocus
      focusable
      onFocus={() => setKeyboardFocused(true)}
      onBlur={() => setKeyboardFocused(false)}
      onKeyDownPress={handleKeyboardDown}
      onKeyUpPress={handleKeyboardUp}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>MorseForge Keylink</Text>
          <Text style={styles.subtitle}>
            BLE keyboard input for Vail Adapter
          </Text>
        </View>

        <View style={styles.statusRow}>
          <View style={styles.statusBlock}>
            <Text style={styles.label}>Keyboard</Text>
            <Text style={styles.value}>
              {keyboardFocused ? 'Focused' : 'Not focused'}
            </Text>
            <Text style={styles.metaText}>Listening for Ctrl+[ / Ctrl+]</Text>
          </View>
          <View style={styles.statusBlock}>
            <Text style={styles.label}>Last Input</Text>
            <Text style={styles.value}>
              {lastInput
                ? `${lastInput.keyName} ${lastInput.state}`
                : 'Waiting...'}
            </Text>
            <Text style={styles.metaText}>
              {lastInput ? lastInput.combo : 'Pair Keylink in OS settings'}
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

        <View style={styles.instructions}>
          <Text style={styles.label}>How to Connect</Text>
          <Text style={styles.instructionsText}>
            Pair Keylink as a Bluetooth keyboard in system settings. The left
            paddle sends Ctrl+[ and the right paddle sends Ctrl+].
          </Text>
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
          <Pressable style={[styles.button, styles.focusButton]} onPress={focusKeyboard}>
            <Text style={styles.buttonText}>Focus Input</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.resetButton]} onPress={resetSession}>
            <Text style={styles.buttonText}>Reset Keyer</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.retryButton]} onPress={retryAudio}>
            <Text style={styles.buttonText}>Retry Audio</Text>
          </Pressable>
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
    </KeyboardExtendedBaseView>
  );
}

const styles = StyleSheet.create({
  keyboardRoot: {
    flex: 1,
  },
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
  metaText: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 6,
  },
  instructions: {
    backgroundColor: '#111827',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  instructionsText: {
    color: '#cbd5f5',
    fontSize: 12,
    lineHeight: 18,
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
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  focusButton: {
    backgroundColor: '#2563eb',
  },
  resetButton: {
    backgroundColor: '#f59e0b',
  },
  retryButton: {
    backgroundColor: '#0f766e',
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
