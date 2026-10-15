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

export interface Subscription {
  remove(): void;
}

interface AyaPitchDetectorNativeModule {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  isRunning(): boolean;
  addListener(eventName: 'onPitch', listener: (event: NativePitchEvent) => void): Subscription;
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
  } catch (e) {
    return false;
  }
}

export async function stopNativePitchDetector(): Promise<void> {
  if (!AyaPitchDetector) return;
  try {
    await AyaPitchDetector.stop();
  } catch (e) {}
}

export function addNativePitchListener(
  listener: (event: NativePitchEvent) => void
): Subscription | null {
  return AyaPitchDetector?.addListener('onPitch', listener) ?? null;
}
