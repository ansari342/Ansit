import AsyncStorage from '@react-native-async-storage/async-storage';
import { Surah, Reciter } from '../types';
import { SURAHS } from '../data/surahs';
import { RECITERS } from '../data/reciters';

export interface SavedSession {
  surahNumber: number;
  fromVerse: number;
  toVerse: number;
  reciterId: string;
  timestamp: number;
}

export const LAST_SESSION_STORAGE_KEY = '@quran_loop_last_session_v1';
export const SURAH_RANGES_STORAGE_KEY = '@quran_loop_surah_ranges_v1';

/**
 * Saves the last selected or played session (surah, verse range, reciter) to AsyncStorage.
 */
export async function saveLastSession(
  surahNumber: number,
  fromVerse: number,
  toVerse: number,
  reciterId: string
): Promise<void> {
  try {
    const surah = SURAHS.find(s => s.number === surahNumber);
    if (!surah) return;

    const safeFrom = Math.max(1, Math.min(fromVerse, surah.numberOfAyahs));
    const safeTo = Math.max(safeFrom, Math.min(toVerse, surah.numberOfAyahs));

    const sessionData: SavedSession = {
      surahNumber,
      fromVerse: safeFrom,
      toVerse: safeTo,
      reciterId,
      timestamp: Date.now(),
    };

    await AsyncStorage.setItem(
      LAST_SESSION_STORAGE_KEY,
      JSON.stringify(sessionData)
    );
  } catch (e) {
    console.warn('Failed to save last selected session:', e);
  }
}

/**
 * Retrieves the last selected or played session from AsyncStorage, validated against known surahs.
 */
export async function getLastSession(): Promise<SavedSession | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SESSION_STORAGE_KEY);
    if (raw) {
      const parsed: SavedSession = JSON.parse(raw);
      const surah = SURAHS.find(s => s.number === parsed.surahNumber);
      if (surah) {
        const safeFrom = Math.max(1, Math.min(parsed.fromVerse, surah.numberOfAyahs));
        const safeTo = Math.max(safeFrom, Math.min(parsed.toVerse, surah.numberOfAyahs));
        const reciterExists = RECITERS.some(r => r.id === parsed.reciterId);
        return {
          surahNumber: surah.number,
          fromVerse: safeFrom,
          toVerse: safeTo,
          reciterId: reciterExists ? parsed.reciterId : RECITERS[0].id,
          timestamp: parsed.timestamp || Date.now(),
        };
      }
    }
  } catch (e) {
    console.warn('Failed to load last selected session:', e);
  }
  return null;
}

/**
 * Saves the custom verse ranges chosen per surah to AsyncStorage.
 */
export async function saveSurahRanges(
  ranges: Record<number, { from: number; to: number }>
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      SURAH_RANGES_STORAGE_KEY,
      JSON.stringify(ranges)
    );
  } catch (e) {
    console.warn('Failed to save surah ranges:', e);
  }
}

/**
 * Loads the custom verse ranges chosen per surah from AsyncStorage.
 */
export async function getSurahRanges(): Promise<Record<number, { from: number; to: number }>> {
  try {
    const raw = await AsyncStorage.getItem(SURAH_RANGES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load surah ranges:', e);
  }
  return {};
}
