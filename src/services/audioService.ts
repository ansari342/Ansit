import { Audio, InterruptionModeIOS, InterruptionModeAndroid, AVPlaybackStatus } from 'expo-av';
import { Reciter } from '../types';
import { getOrDownloadVerseAudio } from './cacheService';

// Global registry of all active Audio.Sound instances to prevent audio leaks / ghost playback
const allActiveSounds = new Set<Audio.Sound>();

let currentSound: Audio.Sound | null = null;
let currentSoundVerseKey: string | null = null;

// Preloaded sound pool (keeps up to 3 adjacent verses decoded & ready in RAM for 0ms skip)
const preloadedSounds = new Map<string, Audio.Sound>();
const preloadingInProgress = new Set<string>();
const MAX_PRELOADED_SOUNDS = 3;

let isAudioInitialized = false;
let activePlaybackId = 0;

export async function initAudioMode(force: boolean = false): Promise<void> {
  if (isAudioInitialized && !force) return;
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      playThroughEarpieceAndroid: false,
    });
    isAudioInitialized = true;
  } catch (e) {
    console.warn('Failed to set audio mode:', e);
  }
}

export type PlaybackStatusCallback = (status: {
  isPlaying: boolean;
  positionMillis: number;
  durationMillis: number;
  didJustFinish: boolean;
  isBuffering: boolean;
}) => void;

function makeVerseKey(reciter: Reciter, surah: number, ayah: number): string {
  return `${reciter.id}_${surah}_${ayah}`;
}

function disposeSoundAsync(sound: Audio.Sound): void {
  allActiveSounds.delete(sound);
  try {
    sound.setOnPlaybackStatusUpdate(null);
  } catch (e) {}
  sound
    .stopAsync()
    .catch(() => {})
    .then(() => sound.unloadAsync())
    .catch(() => {});
}

/**
 * Preload an upcoming or adjacent ayah into RAM so skipping to it is instantaneous.
 */
export async function preloadUpcomingVerse(
  surahNumber: number,
  ayahNumber: number,
  reciter: Reciter,
  playbackSpeed: number = 1.0
): Promise<void> {
  if (reciter.isSurahBased) return;

  const key = makeVerseKey(reciter, surahNumber, ayahNumber);
  if (
    (currentSound && currentSoundVerseKey === key) ||
    preloadedSounds.has(key) ||
    preloadingInProgress.has(key)
  ) {
    return;
  }

  preloadingInProgress.add(key);

  // Evict oldest preloaded sound if pool exceeds limit
  while (preloadedSounds.size >= MAX_PRELOADED_SOUNDS) {
    const oldestKey = preloadedSounds.keys().next().value;
    if (!oldestKey) break;
    const oldSound = preloadedSounds.get(oldestKey);
    preloadedSounds.delete(oldestKey);
    if (oldSound) {
      disposeSoundAsync(oldSound);
    }
  }

  try {
    await initAudioMode();
    const uri = await getOrDownloadVerseAudio(reciter, surahNumber, ayahNumber);
    // Double check not already active or loaded while awaiting URI
    if ((currentSound && currentSoundVerseKey === key) || preloadedSounds.has(key)) {
      return;
    }

    const { sound } = await Audio.Sound.createAsync(
      { uri },
      {
        shouldPlay: false,
        rate: playbackSpeed,
        shouldCorrectPitch: true,
        progressUpdateIntervalMillis: 80,
      }
    );
    allActiveSounds.add(sound);
    preloadedSounds.set(key, sound);
  } catch (e) {
    // Non-fatal preload failure
  } finally {
    preloadingInProgress.delete(key);
  }
}

/**
 * Load and play an ayah with minimal bridge round-trips and non-blocking teardown.
 */
export async function loadAndPlayAyah(
  surahNumber: number,
  ayahNumber: number,
  reciter: Reciter,
  playbackSpeed: number = 1.0,
  onStatusUpdate?: PlaybackStatusCallback,
  initialPositionMillis: number = 0
): Promise<Audio.Sound | null> {
  const currentRequestId = ++activePlaybackId;
  if (!isAudioInitialized) {
    await initAudioMode();
  }

  const key = makeVerseKey(reciter, surahNumber, ayahNumber);

  const createStatusHandler = () => (status: AVPlaybackStatus) => {
    if (currentRequestId !== activePlaybackId) return;

    if (!status.isLoaded) {
      if (onStatusUpdate) {
        onStatusUpdate({
          isPlaying: false,
          positionMillis: 0,
          durationMillis: 1,
          didJustFinish: false,
          isBuffering: true,
        });
      }
      return;
    }

    if (onStatusUpdate) {
      onStatusUpdate({
        isPlaying: status.isPlaying,
        positionMillis: status.positionMillis || 0,
        durationMillis: status.durationMillis || 1,
        didJustFinish: status.didJustFinish || false,
        isBuffering: status.isBuffering,
      });
    }
  };

  // 1. Fast path: If already loaded with this exact key (same verse repeat or continuous surah),
  //    update status & seek in a SINGLE native call!
  if (currentSound && currentSoundVerseKey === key) {
    try {
      currentSound.setOnPlaybackStatusUpdate(createStatusHandler());
      await currentSound.setStatusAsync({
        positionMillis: Math.max(0, initialPositionMillis),
        shouldPlay: true,
        rate: playbackSpeed,
        shouldCorrectPitch: true,
        progressUpdateIntervalMillis: 80,
      });
      return currentSound;
    } catch (e) {
      // Fall through if existing sound became invalid
    }
  }

  // Non-blocking teardown of previous sound so new verse starts immediately with 0ms wait
  if (currentSound) {
    const oldSound = currentSound;
    currentSound = null;
    currentSoundVerseKey = null;
    disposeSoundAsync(oldSound);
  }

  if (currentRequestId !== activePlaybackId) return null;

  // 2. Check if already decoded in our preloadedSounds pool!
  const preloaded = preloadedSounds.get(key);
  if (preloaded) {
    preloadedSounds.delete(key);
    preloaded.setOnPlaybackStatusUpdate(createStatusHandler());
    try {
      if (currentRequestId === activePlaybackId) {
        currentSound = preloaded;
        currentSoundVerseKey = key;
        await preloaded.setStatusAsync({
          positionMillis: Math.max(0, initialPositionMillis),
          shouldPlay: true,
          rate: playbackSpeed,
          shouldCorrectPitch: true,
          progressUpdateIntervalMillis: 80,
        });
        return preloaded;
      } else {
        disposeSoundAsync(preloaded);
        return null;
      }
    } catch (e) {
      disposeSoundAsync(preloaded);
    }
  }

  // 3. Fresh load: pass shouldPlay: true and positionMillis directly to createAsync
  //    to save extra bridge round-trips!
  try {
    const uri = await getOrDownloadVerseAudio(reciter, surahNumber, ayahNumber);
    if (currentRequestId !== activePlaybackId) return null;

    const { sound } = await Audio.Sound.createAsync(
      { uri },
      {
        shouldPlay: true,
        positionMillis: Math.max(0, initialPositionMillis),
        rate: playbackSpeed,
        shouldCorrectPitch: true,
        progressUpdateIntervalMillis: 80,
      },
      createStatusHandler()
    );
    allActiveSounds.add(sound);

    if (currentRequestId === activePlaybackId) {
      currentSound = sound;
      currentSoundVerseKey = key;
      return sound;
    } else {
      disposeSoundAsync(sound);
      return null;
    }
  } catch (error) {
    console.warn(`Error playing audio for ${key}:`, error);
    return null;
  }
}

export function isAudioLoaded(): boolean {
  return currentSound !== null;
}

export async function pauseAudio(): Promise<void> {
  if (currentSound) {
    try {
      await currentSound.pauseAsync();
    } catch (e) {}
  }
}

export async function resumeAudio(): Promise<boolean> {
  if (currentSound) {
    try {
      await initAudioMode();
      await currentSound.playAsync();
      return true;
    } catch (e) {
      console.warn('Failed to resume audio:', e);
    }
  }
  return false;
}

export async function seekAudio(millis: number): Promise<void> {
  if (currentSound) {
    try {
      await currentSound.setPositionAsync(Math.max(0, millis));
    } catch (e) {}
  }
}

export async function setAudioRate(speed: number): Promise<void> {
  if (currentSound) {
    try {
      await currentSound.setRateAsync(speed, true);
    } catch (e) {}
  }
}

export async function stopAndUnloadAudio(): Promise<void> {
  activePlaybackId++;
  currentSound = null;
  currentSoundVerseKey = null;
  preloadedSounds.clear();

  const soundsToUnload = Array.from(allActiveSounds);
  allActiveSounds.clear();

  for (const s of soundsToUnload) {
    disposeSoundAsync(s);
  }
}
