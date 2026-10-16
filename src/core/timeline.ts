/**
 * Timeline: the ONE resolved description of where each verse lives in a reciter's audio.
 *
 *  - `single-file`: the whole surah is one recording; segment times are absolute ms in that file.
 *  - `per-verse`:   every verse is its own file; segment times are relative to that verse's file
 *                   (startMs = 0, endMs = file duration once known).
 *
 * Provenance travels with the data so callers can decide how much to trust it, and upgrades
 * (e.g. exact Quran.com timestamps arriving after playback started) are applied only at verse
 * boundaries so a playing verse never shifts underneath the listener.
 */
export type TimelineKind = 'single-file' | 'per-verse';
export type TimelineSource = 'exact' | 'bundled' | 'estimated' | 'unknown';

export interface TimelineSegment {
  verse: number;
  startMs: number;
  endMs: number;
}

export interface Timeline {
  reciterId: string;
  surahNumber: number;
  kind: TimelineKind;
  source: TimelineSource;
  segments: Record<number, TimelineSegment>;
}

export const SOURCE_RANK: Record<TimelineSource, number> = { unknown: 0, estimated: 1, bundled: 2, exact: 3 };

export function makeTimeline(
  reciterId: string,
  surahNumber: number,
  kind: TimelineKind,
  source: TimelineSource,
  ranges: Record<number, { startMs: number; endMs: number }>
): Timeline {
  const segments: Record<number, TimelineSegment> = {};
  for (const key of Object.keys(ranges)) {
    const verse = Number(key);
    const r = ranges[verse];
    segments[verse] = { verse, startMs: Math.max(0, r.startMs), endMs: Math.max(r.startMs + 1, r.endMs) };
  }
  return { reciterId, surahNumber, kind, source, segments };
}

/** A per-verse timeline where durations are discovered as files load. */
export function makePerVerseTimeline(reciterId: string, surahNumber: number, verseCount: number): Timeline {
  const segments: Record<number, TimelineSegment> = {};
  for (let v = 1; v <= verseCount; v++) segments[v] = { verse: v, startMs: 0, endMs: 1 };
  return { reciterId, surahNumber, kind: 'per-verse', source: 'exact', segments };
}

export function segmentFor(timeline: Timeline | null, verse: number): TimelineSegment | null {
  return timeline?.segments[verse] ?? null;
}

export function segmentDurationMs(timeline: Timeline | null, verse: number): number {
  const s = segmentFor(timeline, verse);
  return s ? Math.max(1, s.endMs - s.startMs) : 1;
}

/** Finds which verse (within [from, to]) an absolute single-file position belongs to. */
export function verseAtPosition(timeline: Timeline, absMs: number, from: number, to: number): number | null {
  for (let v = from; v <= to; v++) {
    const s = timeline.segments[v];
    if (s && absMs >= s.startMs && absMs < s.endMs) return v;
  }
  return null;
}

/** Returns a copy with a per-verse segment's duration updated once the player reports it. */
export function withVerseDuration(timeline: Timeline, verse: number, durationMs: number): Timeline {
  const current = timeline.segments[verse];
  if (!current || Math.abs(current.endMs - current.startMs - durationMs) < 30) return timeline;
  return {
    ...timeline,
    segments: { ...timeline.segments, [verse]: { verse, startMs: 0, endMs: Math.max(1, durationMs) } },
  };
}

/** Rescales an estimated single-file timeline to a newly discovered total duration. */
export function rescaleToDuration(timeline: Timeline, totalDurationMs: number): Timeline {
  if (timeline.source !== 'estimated' || timeline.kind !== 'single-file') return timeline;
  const verses = Object.keys(timeline.segments).map(Number).sort((a, b) => a - b);
  if (verses.length === 0) return timeline;
  const last = timeline.segments[verses[verses.length - 1]];
  if (!last || last.endMs <= 0 || Math.abs(last.endMs - totalDurationMs) < 250) return timeline;
  const k = totalDurationMs / last.endMs;
  const segments: Record<number, TimelineSegment> = {};
  for (const v of verses) {
    const s = timeline.segments[v];
    segments[v] = { verse: v, startMs: Math.round(s.startMs * k), endMs: Math.round(s.endMs * k) };
  }
  return { ...timeline, segments };
}

/**
 * Chooses between the current timeline and a candidate. Higher provenance wins; equal provenance
 * keeps the current one (stability beats churn).
 */
export function preferTimeline(current: Timeline | null, candidate: Timeline | null): Timeline | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return SOURCE_RANK[candidate.source] > SOURCE_RANK[current.source] ? candidate : current;
}
