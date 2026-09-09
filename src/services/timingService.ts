import AsyncStorage from '@react-native-async-storage/async-storage';
import { Reciter, Verse } from '../types';
import {
  AyahTiming,
  RECITER_TIMINGS,
  getSurahVerseTimings,
} from '../data/reciterTimings';

// High-speed in-memory cache for 0ms lookups during playback
const memoryTimingsCache = new Map<string, Record<number, AyahTiming>>();

function getCacheKey(reciterId: string, surahNumber: number): string {
  return `${reciterId}_${surahNumber}`;
}

const STORAGE_PREFIX = '@ayah_timings_v2_';

/**
 * Returns instantaneous timings synchronously:
 * 1. Memory cache
 * 2. Pre-bundled high precision timings in RECITER_TIMINGS
 * 3. Acoustic-phonetic alignment fallback
 */
export function getInstantTimings(
  reciter: Reciter,
  surahNumber: number,
  verses: Verse[],
  totalDurationMs: number = 180000
): Record<number, AyahTiming> {
  const key = getCacheKey(reciter.id, surahNumber);
  if (memoryTimingsCache.has(key)) {
    return memoryTimingsCache.get(key)!;
  }

  if (RECITER_TIMINGS[reciter.id]?.[surahNumber]) {
    const bundled = RECITER_TIMINGS[reciter.id][surahNumber];
    memoryTimingsCache.set(key, bundled);
    return bundled;
  }

  return getSurahVerseTimings(reciter.id, surahNumber, verses, totalDurationMs);
}

/**
 * Fetches millisecond-accurate verse timestamps for seamless, gapless playback.
 * Queries Quran.com v4 API if available, caches persistently, and falls back gracefully.
 */
export async function fetchSurahVerseTimings(
  reciter: Reciter,
  surahNumber: number,
  verses: Verse[],
  totalDurationMs?: number
): Promise<Record<number, AyahTiming>> {
  const key = getCacheKey(reciter.id, surahNumber);

  // 1. Check in-memory cache
  if (memoryTimingsCache.has(key)) {
    return memoryTimingsCache.get(key)!;
  }

  // 2. Check bundled tables
  if (RECITER_TIMINGS[reciter.id]?.[surahNumber]) {
    const bundled = RECITER_TIMINGS[reciter.id][surahNumber];
    memoryTimingsCache.set(key, bundled);
    return bundled;
  }

  // 3. Check persistent AsyncStorage
  try {
    const stored = await AsyncStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<number, AyahTiming>;
      if (Object.keys(parsed).length > 0) {
        memoryTimingsCache.set(key, parsed);
        return parsed;
      }
    }
  } catch (e) {
    // proceed to network
  }

  // 4. Fetch live verse timestamps from Quran.com API
  if (reciter.quranComId) {
    try {
      const apiUrl = `https://api.quran.com/api/v4/chapter_recitations/${reciter.quranComId}/${surahNumber}?segments=true`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const data = await res.json();
        const timestamps = data.audio_file?.timestamps || [];
        if (timestamps.length > 0) {
          const parsedTimings: Record<number, AyahTiming> = {};

          for (let i = 0; i < timestamps.length; i++) {
            const item = timestamps[i];
            const ayahNum = parseInt(item.verse_key.split(':')[1], 10);
            parsedTimings[ayahNum] = {
              startMs: Math.max(0, item.timestamp_from),
              endMs: Math.max(item.timestamp_from + 200, item.timestamp_to),
            };
          }

          // Ensure contiguous boundaries
          const sortedAyahs = Object.keys(parsedTimings)
            .map(Number)
            .sort((a, b) => a - b);

          for (let i = 0; i < sortedAyahs.length - 1; i++) {
            const curr = sortedAyahs[i];
            const next = sortedAyahs[i + 1];
            if (parsedTimings[curr].endMs !== parsedTimings[next].startMs) {
              parsedTimings[curr].endMs = parsedTimings[next].startMs;
            }
          }

          memoryTimingsCache.set(key, parsedTimings);
          AsyncStorage.setItem(
            `${STORAGE_PREFIX}${key}`,
            JSON.stringify(parsedTimings)
          ).catch(() => {});

          return parsedTimings;
        }
      }
    } catch (networkErr) {
      console.warn(`Failed to fetch timing for ${reciter.id} Surah ${surahNumber}:`, networkErr);
    }
  }

  // 5. Fallback to phonetic text aligner
  const fallback = getSurahVerseTimings(
    reciter.id,
    surahNumber,
    verses,
    totalDurationMs && totalDurationMs > 1000 ? totalDurationMs : 180000
  );
  memoryTimingsCache.set(key, fallback);
  return fallback;
}
