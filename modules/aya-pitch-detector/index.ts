import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export interface NativePitchEvent {
  freqHz: number;
  midi: number;
  confidence: number;
  rms: number;
  db: number;
  isVoiced: boolean;
  timestamp: number;
}

export interface NativeSpeechSegment {
  substring: string;
  timestamp: number;
  duration: number;
  confidence: number;
}

export interface NativeSpeechEvent {
  transcript: string;
  isFinal: boolean;
  segments: NativeSpeechSegment[];
}

export interface Subscription {
  remove(): void;
}

interface AyaPitchDetectorNativeModule {
  start(): Promise<boolean>;
  startSpeech?(localeId?: string): Promise<boolean>;
  stopSpeech?(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  addListener(eventName: 'onPitch', listener: (event: NativePitchEvent) => void): Subscription;
  addListener(eventName: 'onSpeech', listener: (event: NativeSpeechEvent) => void): Subscription;
}

const AyaPitchDetector: AyaPitchDetectorNativeModule | null =
  Platform.OS === 'ios'
    ? requireOptionalNativeModule<AyaPitchDetectorNativeModule>('AyaPitchDetector')
    : null;

export const isNativePitchDetectorAvailable = AyaPitchDetector !== null;

export async function startNativePitchDetector(): Promise<boolean> {
  if (!AyaPitchDetector) return false;
  try {
    return await AyaPitchDetector.start();
  } catch {
    return false;
  }
}

export async function startNativeSpeechRecognizer(localeId: string = 'ar-SA'): Promise<boolean> {
  if (!AyaPitchDetector) return false;
  try {
    if (AyaPitchDetector.startSpeech) {
      return await AyaPitchDetector.startSpeech(localeId);
    }
    return await AyaPitchDetector.start();
  } catch {
    return false;
  }
}

export async function stopNativeSpeechRecognizer(): Promise<void> {
  if (!AyaPitchDetector) return;
  try {
    if (AyaPitchDetector.stopSpeech) {
      await AyaPitchDetector.stopSpeech();
      return;
    }
    await AyaPitchDetector.stop();
  } catch {}
}

export async function stopNativePitchDetector(): Promise<void> {
  if (!AyaPitchDetector) return;
  try {
    await AyaPitchDetector.stop();
  } catch {}
}

export function addNativePitchListener(
  listener: (event: NativePitchEvent) => void
): Subscription | null {
  return AyaPitchDetector?.addListener('onPitch', listener) ?? null;
}

export function addNativeSpeechListener(
  listener: (event: NativeSpeechEvent) => void
): Subscription | null {
  return AyaPitchDetector?.addListener('onSpeech', listener) ?? null;
}
