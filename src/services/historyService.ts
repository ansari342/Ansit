import AsyncStorage from '@react-native-async-storage/async-storage';
import { Surah, Reciter } from '../types';

export interface HistoryItem {
  id: string;
  surahNumber: number;
  surahName: string;
  surahArabicName?: string;
  fromVerse: number;
  toVerse: number;
  reciterId: string;
  reciterName: string;
  timestamp: number;
}

const STORAGE_KEY = '@quran_loop_recently_played_v1';

// Initial fallback matching the mockup
const INITIAL_DEFAULTS: HistoryItem[] = [
  {
    id: '18_1_10_mishary',
    surahNumber: 18,
    surahName: 'Al-Kahf',
    fromVerse: 1,
    toVerse: 10,
    reciterId: 'mishary',
    reciterName: 'Mishary Alafasy',
    timestamp: Date.now() - 3600000 * 2,
  },
  {
    id: '36_1_83_abdulbasit',
    surahNumber: 36,
    surahName: 'Ya-Sin',
    fromVerse: 1,
    toVerse: 83,
    reciterId: 'abdulbasit',
    reciterName: 'Abdul Basit',
    timestamp: Date.now() - 3600000 * 5,
  },
];

export async function getRecentlyPlayed(): Promise<HistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load recently played history:', e);
  }
  return INITIAL_DEFAULTS;
}

export async function addRecentlyPlayed(
  surah: Surah,
  fromVerse: number,
  toVerse: number,
  reciter: Reciter
): Promise<HistoryItem[]> {
  try {
    const currentList = await getRecentlyPlayed();
    const newItem: HistoryItem = {
      id: `${surah.number}_${fromVerse}_${toVerse}_${reciter.id}`,
      surahNumber: surah.number,
      surahName: surah.englishName,
      surahArabicName: surah.name,
      fromVerse,
      toVerse,
      reciterId: reciter.id,
      reciterName: reciter.shortName,
      timestamp: Date.now(),
    };

    // Remove duplicates of the same surah and range
    const filtered = currentList.filter(
      item =>
        !(
          item.surahNumber === surah.number &&
          item.fromVerse === fromVerse &&
          item.toVerse === toVerse &&
          item.reciterId === reciter.id
        )
    );

    const updated = [newItem, ...filtered].slice(0, 10);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.warn('Failed to save recently played item:', e);
    return [];
  }
}

export async function removeRecentlyPlayed(id: string): Promise<HistoryItem[]> {
  try {
    const currentList = await getRecentlyPlayed();
    const filtered = currentList.filter(item => item.id !== id);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return filtered;
  } catch (e) {
    console.warn('Failed to remove recently played item:', e);
    return [];
  }
}
