export interface Surah {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  numberOfAyahs: number;
  revelationType: string;
}

export interface Verse {
  numberInSurah: number;
  surahNumber: number;
  arabicText: string;
  englishText: string;
  audioUrl?: string;
}

export interface Reciter {
  id: string;
  name: string;
  subfolder: string;
  shortName: string;
  isSurahBased?: boolean;
  baseUrl?: string;
  badge?: string;
}

export type LoopMode = 'range' | 'single' | 'off';

export interface LoopSettings {
  mode: LoopMode;
  verseRepeatCount: number;
  playbackSpeed: number;
  delayBetweenVersesSeconds: number;
}

export interface PlaySession {
  surah: Surah;
  fromVerse: number;
  toVerse: number;
  currentVerse: number;
  reciter: Reciter;
  repeatCounter: number;
}
