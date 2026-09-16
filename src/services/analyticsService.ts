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
  surahCounts: Record<number, number>; // surahNumber -> sessions count
  surahMinutes: Record<number, number>; // surahNumber -> total listening minutes
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
export const DEFAULT_ANALYTICS: UserAnalytics = {
  totalSessions: 24,
  totalMinutes: 186,
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
  surahMinutes: {
    1: 12,  // Al-Fatihah (12m)
    2: 64,  // Al-Baqarah (1h 04m)
    18: 38, // Al-Kahf (38m)
    36: 24, // Ya-Sin (24m)
    55: 32, // Ar-Rahman (32m)
    56: 19, // Al-Waqi'ah (19m)
    67: 52, // Al-Mulk (52m)
    78: 14, // An-Naba (14m)
    93: 9,  // Ad-Duha (9m)
    94: 7,  // Ash-Sharh (7m)
    97: 6,  // Al-Qadr (6m)
    108: 5, // Al-Kawthar (5m)
    112: 18,// Al-Ikhlas (18m)
    113: 11,// Al-Falaq (11m)
    114: 13,// An-Nas (13m)
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
    Mon: 18,
    Tue: 28,
    Wed: 22,
    Thu: 14,
    Fri: 45,
    Sat: 32,
    Sun: 27,
  },
};

export async function getAnalytics(): Promise<UserAnalytics> {
  try {
    const raw = await AsyncStorage.getItem(ANALYTICS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const counts = parsed.surahCounts || DEFAULT_ANALYTICS.surahCounts;
        const minutes: Record<number, number> = {
          ...DEFAULT_ANALYTICS.surahMinutes,
          ...(parsed.surahMinutes || {}),
        };

        // Ensure any surah with recorded sessions also has a time entry
        for (const [sNum, cnt] of Object.entries(counts)) {
          const num = Number(sNum);
          if (minutes[num] === undefined && Number(cnt) > 0) {
            minutes[num] = Math.max(1, Math.round(Number(cnt) * 3.5));
          }
        }

        return {
          ...DEFAULT_ANALYTICS,
          ...parsed,
          surahCounts: counts,
          surahMinutes: minutes,
          verseCounts: parsed.verseCounts || DEFAULT_ANALYTICS.verseCounts,
          reciterCounts: parsed.reciterCounts || DEFAULT_ANALYTICS.reciterCounts,
          weeklyMinutes: parsed.weeklyMinutes || DEFAULT_ANALYTICS.weeklyMinutes,
        };
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
  let newStreak = current.currentStreakDays || 1;
  if (current.lastListenDate !== today) {
    const lastDate = new Date(current.lastListenDate || today);
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
  const updatedVerseCounts = { ...(current.verseCounts || {}) };
  for (let v = fromVerse; v <= toVerse; v++) {
    const key = `${surah.number}:${v}`;
    updatedVerseCounts[key] = (updatedVerseCounts[key] || 0) + 1;
  }

  const updatedWeekly = { ...(current.weeklyMinutes || {}) };
  updatedWeekly[dayOfWeek] = (updatedWeekly[dayOfWeek] || 0) + addedMinutes;

  const currentSurahMinutes = current.surahMinutes || {};
  const currentSurahCounts = current.surahCounts || {};

  const updated: UserAnalytics = {
    totalSessions: (current.totalSessions || 0) + 1,
    totalMinutes: (current.totalMinutes || 0) + addedMinutes,
    totalVersesLooped: (current.totalVersesLooped || 0) + verseSpan,
    currentStreakDays: newStreak,
    lastListenDate: today,
    surahCounts: {
      ...currentSurahCounts,
      [surah.number]: (currentSurahCounts[surah.number] || 0) + 1,
    },
    surahMinutes: {
      ...currentSurahMinutes,
      [surah.number]: (currentSurahMinutes[surah.number] || 0) + addedMinutes,
    },
    verseCounts: updatedVerseCounts,
    reciterCounts: {
      ...(current.reciterCounts || {}),
      [reciter.id]: ((current.reciterCounts || {})[reciter.id] || 0) + 1,
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
  const currentSurahMinutes = current.surahMinutes || {};
  const updated: UserAnalytics = {
    ...current,
    totalVersesLooped: (current.totalVersesLooped || 0) + 1,
    surahMinutes: {
      ...currentSurahMinutes,
      [surahNumber]: Math.round(((currentSurahMinutes[surahNumber] || 0) + 0.5) * 10) / 10,
    },
    verseCounts: {
      ...(current.verseCounts || {}),
      [key]: ((current.verseCounts || {})[key] || 0) + 1,
    },
  };
  await saveAnalytics(updated);
}

export interface TopSurahResult {
  surah: Surah;
  count: number;
  minutes: number;
}

export function getTopSurah(analytics: UserAnalytics): TopSurahResult | null {
  let topNum = 67;
  let maxMinutes = -1;

  const minutesMap = analytics?.surahMinutes || DEFAULT_ANALYTICS.surahMinutes;
  const countsMap = analytics?.surahCounts || DEFAULT_ANALYTICS.surahCounts;

  for (const [numStr, mins] of Object.entries(minutesMap)) {
    if (mins > maxMinutes) {
      maxMinutes = mins;
      topNum = Number(numStr);
    }
  }

  const surah = SURAHS.find(s => s.number === topNum) || SURAHS[66];
  const count = countsMap[topNum] || 1;
  return { surah, count, minutes: Math.max(1, Math.round(maxMinutes)) };
}

export function getTopSurahsByTime(analytics: UserAnalytics, limit: number = 3): TopSurahResult[] {
  const minutesMap = analytics?.surahMinutes || DEFAULT_ANALYTICS.surahMinutes;
  const countsMap = analytics?.surahCounts || DEFAULT_ANALYTICS.surahCounts;

  const list: TopSurahResult[] = [];
  for (const [numStr, mins] of Object.entries(minutesMap)) {
    const num = Number(numStr);
    if (mins > 0) {
      const surah = SURAHS.find(s => s.number === num);
      if (surah) {
        list.push({
          surah,
          minutes: Math.round(mins),
          count: countsMap[num] || 1,
        });
      }
    }
  }

  list.sort((a, b) => b.minutes - a.minutes);
  return list.slice(0, limit);
}

export interface TopVerseResult {
  surah: Surah;
  verseNumber: number;
  count: number;
}

export function getTopVerse(analytics: UserAnalytics): TopVerseResult | null {
  let topKey = '67:1';
  let maxCount = -1;

  const verseMap = analytics?.verseCounts || DEFAULT_ANALYTICS.verseCounts;

  for (const [key, count] of Object.entries(verseMap)) {
    if (count > maxCount) {
      maxCount = count;
      topKey = key;
    }
  }

  const [sStr, vStr] = topKey.split(':');
  const surahNum = Number(sStr) || 67;
  const verseNum = Number(vStr) || 1;
  const surah = SURAHS.find(s => s.number === surahNum) || SURAHS[66];

  return { surah, verseNumber: verseNum, count: Math.max(1, maxCount) };
}

export interface TopReciterResult {
  reciter: Reciter;
  count: number;
}

export function getTopReciter(analytics: UserAnalytics): TopReciterResult | null {
  let topId = 'raad_al_kurdi';
  let maxCount = -1;

  const reciterMap = analytics?.reciterCounts || DEFAULT_ANALYTICS.reciterCounts;

  for (const [id, count] of Object.entries(reciterMap)) {
    if (count > maxCount) {
      maxCount = count;
      topId = id;
    }
  }

  const reciter = RECITERS.find(r => r.id === topId) || RECITERS[0];
  return { reciter, count: Math.max(1, maxCount) };
}
