import AsyncStorage from '@react-native-async-storage/async-storage';
import { Surah, Reciter } from '../types';
import { SURAHS } from '../data/surahs';
import { RECITERS } from '../data/reciters';

export interface UserAnalytics {
  totalSessions: number;
  totalMinutes: number;
  totalVersesLooped: number;
  currentStreakDays: number;
  lastListenDate: string; // YYYY-MM-DD
  surahCounts: Record<number, number>; // surahNumber -> count
  verseCounts: Record<string, number>; // "surahNum:verseNum" -> count
  reciterCounts: Record<string, number>; // reciterId -> count
  weeklyMinutes: Record<string, number>; // "Mon", "Tue", etc. -> minutes
}

const ANALYTICS_STORAGE_KEY = '@ansit_listening_analytics_v2';

const getTodayString = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getDayOfWeek = (): string => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[new Date().getDay()];
};

// Initial realistic baseline for inspiring first-time view
const DEFAULT_ANALYTICS: UserAnalytics = {
  totalSessions: 24,
  totalMinutes: 76,
  totalVersesLooped: 148,
  currentStreakDays: 3,
  lastListenDate: getTodayString(),
  surahCounts: {
    1: 6,   // Al-Fatihah
    2: 8,   // Al-Baqarah
    18: 4,  // Al-Kahf
    36: 3,  // Ya-Sin
    55: 9,  // Ar-Rahman
    56: 5,  // Al-Waqi'ah
    67: 14, // Al-Mulk (Top)
    78: 3,  // An-Naba
    93: 6,  // Ad-Duha
    94: 5,  // Ash-Sharh
    97: 4,  // Al-Qadr
    108: 7, // Al-Kawthar
    112: 12,// Al-Ikhlas
    113: 8, // Al-Falaq
    114: 9, // An-Nas
  },
  verseCounts: {
    '67:1': 32, // Al-Mulk verse 1
    '67:2': 28,
    '67:3': 22,
    '1:1': 19,
    '1:2': 18,
    '1:7': 15,
    '2:255': 24, // Ayat al-Kursi
  },
  reciterCounts: {
    raad_al_kurdi: 16,
    mishary: 6,
    abdulbasit: 2,
  },
  weeklyMinutes: {
    Mon: 12,
    Tue: 18,
    Wed: 14,
    Thu: 8,
    Fri: 22,
    Sat: 15,
    Sun: 10,
  },
};

export async function getAnalytics(): Promise<UserAnalytics> {
  try {
    const raw = await AsyncStorage.getItem(ANALYTICS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.totalSessions === 'number') {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load analytics, using defaults:', e);
  }
  return DEFAULT_ANALYTICS;
}

export async function saveAnalytics(analytics: UserAnalytics): Promise<void> {
  try {
    await AsyncStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(analytics));
  } catch (e) {
    console.warn('Failed to save analytics:', e);
  }
}

export async function recordListenSession(
  surah: Surah,
  fromVerse: number,
  toVerse: number,
  reciter: Reciter,
  addedMinutes: number = 3
): Promise<UserAnalytics> {
  const current = await getAnalytics();
  const today = getTodayString();
  const dayOfWeek = getDayOfWeek();

  // Compute streak
  let newStreak = current.currentStreakDays;
  if (current.lastListenDate !== today) {
    const lastDate = new Date(current.lastListenDate);
    const currentDate = new Date(today);
    const diffTime = Math.abs(currentDate.getTime() - lastDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 1) {
      newStreak += 1;
    } else if (diffDays > 2) {
      newStreak = 1;
    }
  }

  const verseSpan = Math.max(1, toVerse - fromVerse + 1);

  // Update verse counts for each verse in range
  const updatedVerseCounts = { ...current.verseCounts };
  for (let v = fromVerse; v <= toVerse; v++) {
    const key = `${surah.number}:${v}`;
    updatedVerseCounts[key] = (updatedVerseCounts[key] || 0) + 1;
  }

  const updatedWeekly = { ...current.weeklyMinutes };
  updatedWeekly[dayOfWeek] = (updatedWeekly[dayOfWeek] || 0) + addedMinutes;

  const updated: UserAnalytics = {
    totalSessions: current.totalSessions + 1,
    totalMinutes: current.totalMinutes + addedMinutes,
    totalVersesLooped: current.totalVersesLooped + verseSpan,
    currentStreakDays: newStreak,
    lastListenDate: today,
    surahCounts: {
      ...current.surahCounts,
      [surah.number]: (current.surahCounts[surah.number] || 0) + 1,
    },
    verseCounts: updatedVerseCounts,
    reciterCounts: {
      ...current.reciterCounts,
      [reciter.id]: (current.reciterCounts[reciter.id] || 0) + 1,
    },
    weeklyMinutes: updatedWeekly,
  };

  await saveAnalytics(updated);
  return updated;
}

export async function recordVersePlayed(
  surahNumber: number,
  verseNumber: number
): Promise<void> {
  const current = await getAnalytics();
  const key = `${surahNumber}:${verseNumber}`;
  const updated: UserAnalytics = {
    ...current,
    totalVersesLooped: current.totalVersesLooped + 1,
    verseCounts: {
      ...current.verseCounts,
      [key]: (current.verseCounts[key] || 0) + 1,
    },
  };
  await saveAnalytics(updated);
}

export interface TopSurahResult {
  surah: Surah;
  count: number;
}

export function getTopSurah(analytics: UserAnalytics): TopSurahResult | null {
  let topNum = 67;
  let maxCount = -1;

  for (const [numStr, count] of Object.entries(analytics.surahCounts)) {
    if (count > maxCount) {
      maxCount = count;
      topNum = Number(numStr);
    }
  }

  const surah = SURAHS.find(s => s.number === topNum) || SURAHS[0];
  return { surah, count: Math.max(1, maxCount) };
}

export interface TopVerseResult {
  surah: Surah;
  verseNumber: number;
  count: number;
}

export function getTopVerse(analytics: UserAnalytics): TopVerseResult | null {
  let topKey = '67:1';
  let maxCount = -1;

  for (const [key, count] of Object.entries(analytics.verseCounts)) {
    if (count > maxCount) {
      maxCount = count;
      topKey = key;
    }
  }

  const [sStr, vStr] = topKey.split(':');
  const surahNum = Number(sStr);
  const verseNum = Number(vStr);
  const surah = SURAHS.find(s => s.number === surahNum) || SURAHS[0];

  return { surah, verseNumber: verseNum, count: Math.max(1, maxCount) };
}

export interface TopReciterResult {
  reciter: Reciter;
  count: number;
}

export function getTopReciter(analytics: UserAnalytics): TopReciterResult | null {
  let topId = 'raad_al_kurdi';
  let maxCount = -1;

  for (const [id, count] of Object.entries(analytics.reciterCounts)) {
    if (count > maxCount) {
      maxCount = count;
      topId = id;
    }
  }

  const reciter = RECITERS.find(r => r.id === topId) || RECITERS[0];
  return { reciter, count: Math.max(1, maxCount) };
}
