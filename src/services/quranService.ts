import AsyncStorage from '@react-native-async-storage/async-storage';
import { Surah, Verse } from '../types';
import { SURAHS } from '../data/surahs';
import { PRESET_VERSES } from '../data/presetVerses';

const BISMILLAH = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
const STORAGE_PREFIX = '@quran_verses_v2_';

function cleanVerseText(surahNumber: number, ayahNumber: number, text: string): string {
  if (surahNumber !== 1 && ayahNumber === 1) {
    if (text.startsWith(BISMILLAH)) {
      return text.substring(BISMILLAH.length).trim();
    }
    // Also check for leading BOM or variation of Bismillah
    const cleaned = text.replace(/^﻿?بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\s*/, '').trim();
    if (cleaned.length > 0) return cleaned;
  }
  return text.replace(/^﻿/, '').trim();
}

// Unicode Waqf marks in Quranic text (small pause/stopping signs: U+06D6 to U+06DC, U+06DF to U+06E4, U+06E8)
const WAQF_REGEX = /^[\u06D6-\u06DC\u06DF-\u06E4\u06E8\u08D4-\u08ED]+$/;

/**
 * Splits Arabic verse text into clean word tokens, attaching any standalone
 * Quranic Waqf (stopping) symbols to the preceding word.
 */
export function parseArabicWords(arabicText: string): string[] {
  if (!arabicText) return [];
  const raw = arabicText.trim().split(/\s+/).filter(Boolean);
  const words: string[] = [];
  for (const token of raw) {
    if (WAQF_REGEX.test(token) && words.length > 0) {
      words[words.length - 1] += ' ' + token;
    } else {
      words.push(token);
    }
  }
  return words;
}

const cache: Record<number, Verse[]> = { ...PRESET_VERSES };

export async function getVersesForSurah(surahNumber: number): Promise<Verse[]> {
  // 1. In-memory cache
  if (cache[surahNumber] && cache[surahNumber].length > 0) {
    return cache[surahNumber].map(v => ({
      ...v,
      arabicText: cleanVerseText(surahNumber, v.numberInSurah, v.arabicText),
    }));
  }

  // 2. Persistent disk cache (instant offline loading)
  try {
    const diskData = await AsyncStorage.getItem(`${STORAGE_PREFIX}${surahNumber}`);
    if (diskData) {
      const parsed: Verse[] = JSON.parse(diskData);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cache[surahNumber] = parsed;
        return parsed.map(v => ({
          ...v,
          arabicText: cleanVerseText(surahNumber, v.numberInSurah, v.arabicText),
        }));
      }
    }
  } catch (e) {}

  // 3. Network fetch with 8s abort timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(
      `https://api.alquran.cloud/v1/surah/${surahNumber}/editions/quran-uthmani,en.sahih`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const arAyahs = data.data[0].ayahs;
    const enAyahs = data.data[1].ayahs;

    const verses: Verse[] = arAyahs.map((ar: any, idx: number) => ({
      numberInSurah: ar.numberInSurah,
      surahNumber,
      arabicText: cleanVerseText(surahNumber, ar.numberInSurah, ar.text),
      englishText: enAyahs[idx] ? enAyahs[idx].text : '',
    }));

    cache[surahNumber] = verses;
    AsyncStorage.setItem(`${STORAGE_PREFIX}${surahNumber}`, JSON.stringify(verses)).catch(() => {});
    return verses;
  } catch (error) {
    console.warn(`Failed to fetch verses for surah ${surahNumber}:`, error);
    // Fallback if preset exists
    if (PRESET_VERSES[surahNumber]) {
      return PRESET_VERSES[surahNumber];
    }
    return [];
  }
}

export function getSurahByNumber(surahNumber: number): Surah | undefined {
  return SURAHS.find(s => s.number === surahNumber);
}
