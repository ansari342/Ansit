import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export type RemoteCommandName =
  | 'play'
  | 'pause'
  | 'togglePlayPause'
  | 'nextTrack'
  | 'previousTrack'
  | 'changePlaybackPosition';

export interface RemoteCommandEvent {
  command: RemoteCommandName;
  positionSec?: number;
}

export interface AudioRouteChangeEvent {
  reason: string;
  isOldDeviceUnavailable: boolean;
  previousOutputs: string[];
  currentOutputs: string[];
}

export interface AudioInterruptionEvent {
  type: 'began' | 'ended';
  shouldResume: boolean;
}

export interface NowPlayingInfo {
  title: string;
  artist: string;
  album: string;
  positionSec: number;
  durationSec: number;
  isPlaying: boolean;
  rate: number;
  trackIndex?: number;
  trackCount?: number;
}

export interface Subscription {
  remove(): void;
}

interface AyaNowPlayingNativeModule {
  updateNowPlaying(info: NowPlayingInfo): void;
  updatePlayback(positionSec: number, durationSec: number, isPlaying: boolean, rate: number): void;
  clearNowPlaying(): void;
  getCurrentRouteOutputs(): string[];
  addListener(eventName: 'onRemoteCommand', listener: (event: RemoteCommandEvent) => void): Subscription;
  addListener(eventName: 'onAudioRouteChange', listener: (event: AudioRouteChangeEvent) => void): Subscription;
  addListener(eventName: 'onAudioInterruption', listener: (event: AudioInterruptionEvent) => void): Subscription;
}

const AyaNowPlaying: AyaNowPlayingNativeModule | null =
  Platform.OS === 'ios' ? requireOptionalNativeModule<AyaNowPlayingNativeModule>('AyaNowPlaying') : null;

export const isNowPlayingAvailable = AyaNowPlaying !== null;

export function updateNowPlaying(info: NowPlayingInfo): void {
  try {
    AyaNowPlaying?.updateNowPlaying(info);
  } catch (e) {}
}

export function updatePlayback(
  positionSec: number,
  durationSec: number,
  isPlaying: boolean,
  rate: number
): void {
  try {
    AyaNowPlaying?.updatePlayback(positionSec, durationSec, isPlaying, rate);
  } catch (e) {}
}

export function clearNowPlaying(): void {
  try {
    AyaNowPlaying?.clearNowPlaying();
  } catch (e) {}
}

export function getCurrentRouteOutputs(): string[] {
  try {
    return AyaNowPlaying?.getCurrentRouteOutputs() ?? [];
  } catch (e) {
    return [];
  }
}

export function addRemoteCommandListener(
  listener: (event: RemoteCommandEvent) => void
): Subscription | null {
  return AyaNowPlaying?.addListener('onRemoteCommand', listener) ?? null;
}

export function addAudioRouteChangeListener(
  listener: (event: AudioRouteChangeEvent) => void
): Subscription | null {
  return AyaNowPlaying?.addListener('onAudioRouteChange', listener) ?? null;
}

export function addAudioInterruptionListener(
  listener: (event: AudioInterruptionEvent) => void
): Subscription | null {
  return AyaNowPlaying?.addListener('onAudioInterruption', listener) ?? null;
}
