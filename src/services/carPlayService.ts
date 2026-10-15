import { Surah, Reciter } from '../types';
import {
  updateNowPlaying,
  updatePlayback,
  clearNowPlaying,
  addRemoteCommandListener,
  addAudioRouteChangeListener,
  addAudioInterruptionListener,
  isNowPlayingAvailable,
  RemoteCommandEvent,
  AudioRouteChangeEvent,
  AudioInterruptionEvent,
  Subscription,
} from '../../modules/aya-now-playing';

export interface CarPlayState {
  currentSurah?: Surah;
  currentVerseNum?: number;
  fromVerse?: number;
  toVerse?: number;
  reciter?: Reciter;
  isPlaying: boolean;
  loopIteration?: number;
  maxLoops?: number;
  positionMillis?: number;
  durationMillis?: number;
  playbackRate?: number;
}

export type NowPlayingMediaState = CarPlayState;

export interface NowPlayingHandlers {
  onPlay?: () => void;
  onPause?: () => void;
  onTogglePlayPause?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onSeekToSeconds?: (positionSec: number) => void;
  /** Fired when the current output (CarPlay / Bluetooth / headphones) disappears or is muted away. */
  onAudioRouteLost?: (event: AudioRouteChangeEvent) => void;
  onInterruptionBegan?: () => void;
  onInterruptionEnded?: (shouldResume: boolean) => void;
}

let activeMediaState: CarPlayState = { isPlaying: false };
let lastMetadataKey = '';
let lastPlaybackSyncAt = 0;
let lastSyncedPositionMillis = -1;
let lastSyncedIsPlaying: boolean | null = null;

const EXTERNAL_OUTPUT_PORTS = new Set([
  'CarAudio',
  'BluetoothA2DP',
  'BluetoothHFP',
  'BluetoothLE',
  'Headphones',
  'AirPlay',
  'USBAudio',
  'HDMI',
  'LineOut',
]);
const BUILT_IN_OUTPUT_PORTS = new Set(['Speaker', 'Receiver']);

function buildMetadataKey(state: CarPlayState): string {
  return [
    state.currentSurah?.number ?? 0,
    state.currentVerseNum ?? 0,
    state.fromVerse ?? 0,
    state.toVerse ?? 0,
    state.reciter?.id ?? '',
    Math.round(state.durationMillis ?? 0),
    state.playbackRate ?? 1,
  ].join('|');
}

/**
 * Updates the active audio state that feeds the Dynamic Island, Lock Screen and CarPlay Now Playing.
 * Metadata (title/artist/duration) is pushed only when it changes; the playhead is throttled to ~1 Hz
 * because iOS interpolates elapsed time locally from the playback rate.
 */
export function updateNowPlayingState(newState: Partial<CarPlayState>) {
  activeMediaState = { ...activeMediaState, ...newState };
  if (!isNowPlayingAvailable) return;

  const state = activeMediaState;
  if (!state.currentSurah || !state.reciter) return;

  const positionSec = Math.max(0, (state.positionMillis ?? 0) / 1000);
  const durationSec = Math.max(0.1, (state.durationMillis ?? 1) / 1000);
  const rate = state.playbackRate ?? 1;
  const verseNum = state.currentVerseNum ?? state.fromVerse ?? 1;
  const from = state.fromVerse ?? 1;
  const to = state.toVerse ?? state.currentSurah.numberOfAyahs;

  const metadataKey = buildMetadataKey(state);
  const now = Date.now();

  if (metadataKey !== lastMetadataKey) {
    lastMetadataKey = metadataKey;
    lastPlaybackSyncAt = now;
    lastSyncedPositionMillis = state.positionMillis ?? 0;
    lastSyncedIsPlaying = state.isPlaying;
    updateNowPlaying({
      title: `Ayah ${verseNum} • Surah ${state.currentSurah.englishName}`,
      artist: state.reciter.name,
      album: `${state.currentSurah.name} • Verses ${from}–${to}`,
      positionSec,
      durationSec,
      isPlaying: state.isPlaying,
      rate,
      trackIndex: Math.max(0, verseNum - from),
      trackCount: Math.max(1, to - from + 1),
    });
    return;
  }

  const positionJumped =
    lastSyncedPositionMillis < 0 ||
    Math.abs((state.positionMillis ?? 0) - lastSyncedPositionMillis) > 1500;
  const playStateChanged = lastSyncedIsPlaying !== state.isPlaying;
  const heartbeatDue = now - lastPlaybackSyncAt >= 1000;

  if (positionJumped || playStateChanged || heartbeatDue) {
    lastPlaybackSyncAt = now;
    lastSyncedPositionMillis = state.positionMillis ?? 0;
    lastSyncedIsPlaying = state.isPlaying;
    updatePlayback(positionSec, durationSec, state.isPlaying, rate);
  }
}

export function getNowPlayingState(): CarPlayState {
  return activeMediaState;
}

export function updateCarPlayState(newState: Partial<CarPlayState>) {
  updateNowPlayingState(newState);
}

export function getCarPlayState(): CarPlayState {
  return getNowPlayingState();
}

export function clearNowPlayingState() {
  activeMediaState = { isPlaying: false };
  lastMetadataKey = '';
  lastSyncedPositionMillis = -1;
  lastSyncedIsPlaying = null;
  clearNowPlaying();
}

/**
 * True when audio just moved OFF an external output (CarPlay, Bluetooth, headphones) and onto the
 * iPhone's built-in speaker/receiver, e.g. the car was muted, CarPlay disconnected, or AirPods removed.
 */
export function isExternalRouteLost(event: AudioRouteChangeEvent): boolean {
  if (event.isOldDeviceUnavailable) return true;
  const hadExternal = event.previousOutputs.some(p => EXTERNAL_OUTPUT_PORTS.has(p));
  const nowBuiltInOnly =
    event.currentOutputs.length > 0 && event.currentOutputs.every(p => BUILT_IN_OUTPUT_PORTS.has(p));
  return hadExternal && nowBuiltInOnly;
}

/**
 * Wires Dynamic Island / Lock Screen / CarPlay / steering-wheel commands and audio route loss to the
 * playback controller. Returns an unsubscribe function.
 */
export function registerNowPlayingHandlers(handlers: NowPlayingHandlers): () => void {
  const subscriptions: Subscription[] = [];

  const remoteSub = addRemoteCommandListener((event: RemoteCommandEvent) => {
    switch (event.command) {
      case 'play':
        handlers.onPlay?.();
        break;
      case 'pause':
        handlers.onPause?.();
        break;
      case 'togglePlayPause':
        handlers.onTogglePlayPause?.();
        break;
      case 'nextTrack':
        handlers.onNext?.();
        break;
      case 'previousTrack':
        handlers.onPrevious?.();
        break;
      case 'changePlaybackPosition':
        if (typeof event.positionSec === 'number') {
          handlers.onSeekToSeconds?.(event.positionSec);
        }
        break;
    }
  });
  if (remoteSub) subscriptions.push(remoteSub);

  const routeSub = addAudioRouteChangeListener((event: AudioRouteChangeEvent) => {
    if (isExternalRouteLost(event)) {
      handlers.onAudioRouteLost?.(event);
    }
  });
  if (routeSub) subscriptions.push(routeSub);

  const interruptionSub = addAudioInterruptionListener((event: AudioInterruptionEvent) => {
    if (event.type === 'began') {
      handlers.onInterruptionBegan?.();
    } else {
      handlers.onInterruptionEnded?.(event.shouldResume);
    }
  });
  if (interruptionSub) subscriptions.push(interruptionSub);

  return () => {
    for (const sub of subscriptions) {
      try {
        sub.remove();
      } catch (e) {}
    }
  };
}
