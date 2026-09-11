import AsyncStorage from '@react-native-async-storage/async-storage';
import { Reciter, Verse } from '../types';
import {
  AyahTiming,
  WordTiming,
  RECITER_TIMINGS,
  getSurahVerseTimings,
} from '../data/reciterTimings';
import { BASE_RECITERS } from '../data/reciters';
import { RAAD_SURAH_DURATIONS_MS } from '../data/raadDurations';

// High-speed in-memory cache for 0ms lookups during playback
const memoryTimingsCache = new Map<string, Record<number, AyahTiming>>();

function getCacheKey(reciterId: string, surahNumber: number): string {
  return `${reciterId}_${surahNumber}`;
}

const STORAGE_PREFIX = '@ayah_timings_v3_';

/**
 * Returns instantaneous timings synchronously:
 * 1. Memory cache
 * 2. Pre-bundled high precision timings in RECITER_TIMINGS
 * 3. Canonical Tajweed pacing with verified audio duration
 */
export function getInstantTimings(
  reciter: Reciter,
  surahNumber: number,
  verses: Verse[],
  totalDurationMs: number = 180000
): Record<number, AyahTiming> {
  const actualReciter = reciter.id === 'multiple' ? BASE_RECITERS[0] : reciter;
  const key = getCacheKey(actualReciter.id, surahNumber);
  if (memoryTimingsCache.has(key)) {
    return memoryTimingsCache.get(key)!;
  }

  if (RECITER_TIMINGS[actualReciter.id]?.[surahNumber]) {
    const bundled = RECITER_TIMINGS[actualReciter.id][surahNumber];
    memoryTimingsCache.set(key, bundled);
    return bundled;
  }

  let durationToUse = totalDurationMs;
  if (actualReciter.id === 'raad' && (totalDurationMs === 180000 || totalDurationMs <= 1000)) {
    durationToUse = RAAD_SURAH_DURATIONS_MS[surahNumber] || totalDurationMs;
  }

  const timings = getSurahVerseTimings(actualReciter.id, surahNumber, verses, durationToUse);
  // Do NOT cache fallback timings in memoryTimingsCache if reciter has quranComId,
  // so fetchSurahVerseTimings() can fetch exact millisecond timestamps without being blocked.
  if (!actualReciter.quranComId) {
    memoryTimingsCache.set(key, timings);
  }
  return timings;
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
  const actualReciter = reciter.id === 'multiple' ? BASE_RECITERS[0] : reciter;
  const key = getCacheKey(actualReciter.id, surahNumber);

  // 1. Check in-memory cache
  if (memoryTimingsCache.has(key)) {
    return memoryTimingsCache.get(key)!;
  }

  // 2. Check bundled tables
  if (RECITER_TIMINGS[actualReciter.id]?.[surahNumber]) {
    const bundled = RECITER_TIMINGS[actualReciter.id][surahNumber];
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
  if (actualReciter.quranComId) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const apiUrl = `https://api.quran.com/api/v4/chapter_recitations/${actualReciter.quranComId}/${surahNumber}?segments=true`;
      const res = await fetch(apiUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        const timestamps = data.audio_file?.timestamps || [];
        if (timestamps.length > 0) {
          const parsedTimings: Record<number, AyahTiming> = {};

          for (let i = 0; i < timestamps.length; i++) {
            const item = timestamps[i];
            const ayahNum = parseInt(item.verse_key.split(':')[1], 10);
            const rawSegments = item.segments || [];
            const validWords: WordTiming[] = rawSegments
              .filter((s: any) => Array.isArray(s) && s.length >= 3)
              .map((s: any) => ({
                wordIndex: s[0],
                startMs: Math.max(0, s[1]),
                endMs: Math.max(s[1] + 50, s[2]),
              }));

            parsedTimings[ayahNum] = {
              startMs: Math.max(0, item.timestamp_from),
              endMs: Math.max(item.timestamp_from + 200, item.timestamp_to),
              words: validWords.length > 0 ? validWords : undefined,
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

  // 5. Fallback to canonical Tajweed / acoustic aligner
  const fallback = getSurahVerseTimings(
    actualReciter.id,
    surahNumber,
    verses,
    totalDurationMs && totalDurationMs > 1000 ? totalDurationMs : 180000
  );
  if (!actualReciter.quranComId) {
    memoryTimingsCache.set(key, fallback);
  }
  return fallback;
}

/**
 * Returns precise millisecond start/end timestamps for each word in an ayah.
 * Prefers official verified segments from Quran.com, or computes a smooth,
 * proportional Tajweed pacing curve across the verse's true audio duration.
 */
export function getAyahWordTimings(
  ayahTiming: AyahTiming | undefined,
  words: string[],
  zeroIndexed: boolean = false,
  customDurationMs?: number
): WordTiming[] {
  if (!words || words.length === 0) return [];
  if (!ayahTiming) return [];

  const wordCount = words.length;

  // If verified word segments from Quran.com exist
  if (ayahTiming.words && ayahTiming.words.length > 0) {
    const wordMap = new Map<number, { startMs: number; endMs: number }>();
    for (const s of ayahTiming.words) {
      if (s.wordIndex >= 1 && s.wordIndex <= wordCount) {
        wordMap.set(s.wordIndex, { startMs: s.startMs, endMs: s.endMs });
      }
    }

    if (wordMap.size === wordCount) {
      const shift = zeroIndexed ? (ayahTiming.startMs || 0) : 0;
      const result: WordTiming[] = [];
      for (let i = 1; i <= wordCount; i++) {
        const seg = wordMap.get(i)!;
        const s = Math.max(0, seg.startMs - shift);
        const e = Math.max(s + 50, seg.endMs - shift);
        result.push({ wordIndex: i, startMs: s, endMs: e });
      }
      return result;
    }
  }

  // Fallback to continuous character-weighted proportional distribution
  const startMs = zeroIndexed ? 0 : ayahTiming.startMs;
  const totalDuration =
    customDurationMs && customDurationMs > 400
      ? customDurationMs
      : Math.max(400, ayahTiming.endMs - ayahTiming.startMs);
  const endMs = startMs + totalDuration;

  // Proportional phonetic character-length weighting
  const weights = words.map(w => Math.max(1, w.length));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;

  let cursor = startMs;
  return words.map((_, i) => {
    const wordDur = (weights[i] / totalWeight) * totalDuration;
    const s = Math.round(cursor);
    const e = i === words.length - 1 ? endMs : Math.round(cursor + wordDur);
    cursor = e;
    return {
      wordIndex: i + 1,
      startMs: s,
      endMs: Math.max(s + 50, e),
    };
  });
}

