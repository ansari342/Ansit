import { Surah, Reciter, Verse } from '../types';

export interface CarPlayState {
  currentSurah?: Surah;
  currentVerseNum?: number;
  reciter?: Reciter;
  isPlaying: boolean;
}

let activeCarPlayState: CarPlayState = {
  isPlaying: false,
};

/**
 * Updates the active audio state that feeds CarPlay and the vehicle head-unit
 */
export function updateCarPlayState(newState: Partial<CarPlayState>) {
  activeCarPlayState = { ...activeCarPlayState, ...newState };
}

export function getCarPlayState(): CarPlayState {
  return activeCarPlayState;
}

/**
 * CarPlay Scene Configuration Documentation:
 *
 * To build a standalone iOS app with native CarPlay screen templates on the car dashboard:
 * 1. Obtain the CarPlay entitlement from Apple Developer Portal:
 *    - "CarPlay Audio App" (com.apple.developer.carplay-audio)
 * 2. In app.json:
 *    - ios.entitlements["com.apple.developer.carplay-audio"] = true
 *    - ios.infoPlist["UIBackgroundModes"] = ["audio"]
 * 3. Install `react-native-carplay`:
 *    - npm install react-native-carplay
 * 4. Run `npx expo prebuild` and build with EAS or Xcode.
 */
