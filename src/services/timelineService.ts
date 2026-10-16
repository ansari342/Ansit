/**
 * TimelineService — adapts the existing timing sources into ONE resolved `Timeline` with provenance.
 *
 *   exact     → Quran.com verse timestamps (network / persisted)
 *   bundled   → hand-tuned RECITER_TIMINGS
 *   estimated → canonical pacing scaled to the recording length
 *
 * `resolveInstant` is synchronous (what we can know right now); `resolveExact` upgrades
 * asynchronously. The PlaybackEngine applies upgrades only at verse boundaries.
 */
import { Reciter, Verse } from '../types';
import { AyahTiming, RECITER_TIMINGS } from '../data/reciterTimings';
import { BASE_RECITERS } from '../data/reciters';
import { Timeline, makePerVerseTimeline, makeTimeline } from '../core/timeline';
import { getInstantTimings, fetchSurahVerseTimings } from './timingService';

export function effectiveReciter(reciter: Reciter): Reciter {
  return reciter.id === 'multiple' ? BASE_RECITERS[0] : reciter;
}

export function timelineFromTimings(
  reciter: Reciter,
  surahNumber: number,
  timings: Record<number, AyahTiming>,
  source: Timeline['source']
): Timeline {
  const ranges: Record<number, { startMs: number; endMs: number }> = {};
  for (const key of Object.keys(timings)) {
    const v = Number(key);
    ranges[v] = { startMs: timings[v].startMs, endMs: timings[v].endMs };
  }
  return makeTimeline(effectiveReciter(reciter).id, surahNumber, 'single-file', source, ranges);
}

/** Synchronous best-available timeline for a reciter + surah. */
export function resolveInstantTimeline(
  reciter: Reciter,
  surahNumber: number,
  verses: Verse[],
  knownDurationMs: number
): { timeline: Timeline; timings: Record<number, AyahTiming> } {
  const rec = effectiveReciter(reciter);
  if (!rec.isSurahBased) {
    const timeline = makePerVerseTimeline(rec.id, surahNumber, Math.max(1, verses.length));
    const timings: Record<number, AyahTiming> = {};
    for (const v of verses) timings[v.numberInSurah] = { startMs: 0, endMs: 1 };
    return { timeline, timings };
  }
  const bundled = RECITER_TIMINGS[rec.id]?.[surahNumber];
  if (bundled) {
    return { timeline: timelineFromTimings(rec, surahNumber, bundled, 'bundled'), timings: bundled };
  }
  const estimated = getInstantTimings(rec, surahNumber, verses, knownDurationMs > 1000 ? knownDurationMs : 180000);
  return { timeline: timelineFromTimings(rec, surahNumber, estimated, 'estimated'), timings: estimated };
}

/** Asynchronous upgrade to exact Quran.com timestamps (resolves null when unavailable). */
export async function resolveExactTimeline(
  reciter: Reciter,
  surahNumber: number,
  verses: Verse[],
  knownDurationMs?: number
): Promise<{ timeline: Timeline; timings: Record<number, AyahTiming> } | null> {
  const rec = effectiveReciter(reciter);
  if (!rec.isSurahBased || !rec.quranComId) return null;
  try {
    const exact = await fetchSurahVerseTimings(rec, surahNumber, verses, knownDurationMs);
    if (!exact || Object.keys(exact).length === 0) return null;
    const hasWords = Object.values(exact).some(t => t.words && t.words.length > 0);
    const isBundled = RECITER_TIMINGS[rec.id]?.[surahNumber] === exact;
    const source: Timeline['source'] = hasWords ? 'exact' : isBundled ? 'bundled' : 'estimated';
    return { timeline: timelineFromTimings(rec, surahNumber, exact, source), timings: exact };
  } catch (e) {
    return null;
  }
}
