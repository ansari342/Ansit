import { Audio, InterruptionModeIOS, InterruptionModeAndroid, AVPlaybackStatus } from 'expo-av';
import { Reciter } from '../types';
import { getOrDownloadVerseAudio } from './cacheService';

let currentSound: Audio.Sound | null = null;
let nextSound: Audio.Sound | null = null;
let nextVerseKey: string | null = null;
let isAudioInitialized = false;
let activePlaybackId = 0;
let currentSoundVerseKey: string | null = null;

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

/**
 * Preload the upcoming ayah into memory so it's already decoded and buffered.
 */
export async function preloadUpcomingVerse(
  surahNumber: number,
  ayahNumber: number,
  reciter: Reciter,
  playbackSpeed: number = 1.0
): Promise<void> {
  const key = makeVerseKey(reciter, surahNumber, ayahNumber);
  if (nextSound && nextVerseKey === key) {
    // Already preloaded!
    return;
  }

  // Clear previous nextSound if different
  if (nextSound) {
    try {
      await nextSound.unloadAsync();
    } catch (e) {}
    nextSound = null;
    nextVerseKey = null;
  }

  try {
    const uri = await getOrDownloadVerseAudio(reciter, surahNumber, ayahNumber);
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: false, rate: playbackSpeed, shouldCorrectPitch: true }
    );
    nextSound = sound;
    nextVerseKey = key;
  } catch (e) {
    console.warn(`Failed to preload upcoming verse ${key}:`, e);
  }
}

/**
 * Load and play an ayah. Uses activePlaybackId token to eliminate race conditions
 * during rapid seeking, skipping, or reciter switching.
 */
export async function loadAndPlayAyah(
  surahNumber: number,
  ayahNumber: number,
  reciter: Reciter,
  playbackSpeed: number = 1.0,
  onStatusUpdate?: PlaybackStatusCallback
): Promise<Audio.Sound | null> {
  const currentRequestId = ++activePlaybackId;
  await initAudioMode();

  const key = makeVerseKey(reciter, surahNumber, ayahNumber);

  const createStatusHandler = () => (status: AVPlaybackStatus) => {
    // Ignore updates if this playback request was superseded
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

  // 1. If already loaded with this exact key (continuous surah), reuse sound directly!
  if (currentSound && currentSoundVerseKey === key) {
    try {
      const status = await currentSound.getStatusAsync();
      if (status.isLoaded) {
        currentSound.setOnPlaybackStatusUpdate(createStatusHandler());
        if (status.rate !== playbackSpeed) {
          await currentSound.setRateAsync(playbackSpeed, true);
        }
        if (!status.isPlaying) {
          await currentSound.playAsync();
        }
        return currentSound;
      }
    } catch (e) {}
  }

  // Stop & unload previous sound asynchronously without blocking
  const oldSound = currentSound;
  currentSound = null;
  currentSoundVerseKey = null;
  if (oldSound) {
    oldSound.stopAsync().then(() => oldSound.unloadAsync()).catch(() => {});
  }

  // 2. Check if we already preloaded this in nextSound!
  if (nextSound && nextVerseKey === key) {
    const sound = nextSound;
    nextSound = null;
    nextVerseKey = null;

    sound.setOnPlaybackStatusUpdate(createStatusHandler());
    try {
      await sound.playAsync();
      if (currentRequestId === activePlaybackId) {
        currentSound = sound;
        currentSoundVerseKey = key;
        return sound;
      } else {
        sound.stopAsync().then(() => sound.unloadAsync()).catch(() => {});
        return null;
      }
    } catch (e) {
      console.warn('Preloaded sound play failed, fallback to fresh load', e);
    }
  }

  // 3. Otherwise load from cache or remote stream
  try {
    const uri = await getOrDownloadVerseAudio(reciter, surahNumber, ayahNumber);
    if (currentRequestId !== activePlaybackId) return null;

    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true, rate: playbackSpeed, shouldCorrectPitch: true },
      createStatusHandler()
    );

    if (currentRequestId === activePlaybackId) {
      currentSound = sound;
      currentSoundVerseKey = key;
      return sound;
    } else {
      sound.stopAsync().then(() => sound.unloadAsync()).catch(() => {});
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
      const status = await currentSound.getStatusAsync();
      if (status.isLoaded) {
        await currentSound.playAsync();
        return true;
      }
    } catch (e) {
      console.warn('Failed to resume audio:', e);
    }
  }
  return false;
}

export async function seekAudio(millis: number): Promise<void> {
  if (currentSound) {
    try {
      await currentSound.setPositionAsync(millis);
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
  if (currentSound) {
    try {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
    } catch (e) {}
    currentSound = null;
    currentSoundVerseKey = null;
  }
  if (nextSound) {
    try {
      await nextSound.unloadAsync();
    } catch (e) {}
    nextSound = null;
    nextVerseKey = null;
  }
}
