import { Audio, InterruptionModeIOS, InterruptionModeAndroid, AVPlaybackStatus } from 'expo-av';
import { Reciter } from '../types';
import { getOrDownloadVerseAudio } from './cacheService';

let currentSound: Audio.Sound | null = null;
let nextSound: Audio.Sound | null = null;
let nextVerseKey: string | null = null;
let isAudioInitialized = false;

export async function initAudioMode(): Promise<void> {
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
 * Load and play an ayah. If it was preloaded in nextSound, plays instantly (<10ms)!
 */
export async function loadAndPlayAyah(
  surahNumber: number,
  ayahNumber: number,
  reciter: Reciter,
  playbackSpeed: number = 1.0,
  onStatusUpdate?: PlaybackStatusCallback
): Promise<Audio.Sound | null> {
  await initAudioMode();

  const key = makeVerseKey(reciter, surahNumber, ayahNumber);

  // Stop & unload previous sound asynchronously without blocking
  const oldSound = currentSound;
  currentSound = null;
  if (oldSound) {
    oldSound.stopAsync().then(() => oldSound.unloadAsync()).catch(() => {});
  }

  const createStatusHandler = () => (status: AVPlaybackStatus) => {
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

  // CHECK IF WE ALREADY PRELOADED THIS IN NEXT SOUND!
  if (nextSound && nextVerseKey === key) {
    const sound = nextSound;
    nextSound = null;
    nextVerseKey = null;

    sound.setOnPlaybackStatusUpdate(createStatusHandler());
    try {
      await sound.playAsync();
      currentSound = sound;
      return sound;
    } catch (e) {
      console.warn('Preloaded sound play failed, fallback to fresh load', e);
    }
  }

  // Otherwise load from local cache or remote
  try {
    const uri = await getOrDownloadVerseAudio(reciter, surahNumber, ayahNumber);
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true, rate: playbackSpeed, shouldCorrectPitch: true },
      createStatusHandler()
    );

    currentSound = sound;
    return sound;
  } catch (error) {
    console.warn(`Error playing audio for ${key}:`, error);
    return null;
  }
}

export async function pauseAudio(): Promise<void> {
  if (currentSound) {
    try {
      await currentSound.pauseAsync();
    } catch (e) {}
  }
}

export async function resumeAudio(): Promise<void> {
  if (currentSound) {
    try {
      await initAudioMode();
      await currentSound.playAsync();
    } catch (e) {}
  }
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
  if (currentSound) {
    try {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
    } catch (e) {}
    currentSound = null;
  }
  if (nextSound) {
    try {
      await nextSound.unloadAsync();
    } catch (e) {}
    nextSound = null;
    nextVerseKey = null;
  }
}
