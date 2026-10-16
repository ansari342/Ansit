import {
  makeTimeline,
  makePerVerseTimeline,
  verseAtPosition,
  withVerseDuration,
  rescaleToDuration,
  preferTimeline,
  segmentDurationMs,
} from '../src/core/timeline';

const fatiha = makeTimeline('mishary', 1, 'single-file', 'bundled', {
  1: { startMs: 0, endMs: 6090 },
  2: { startMs: 6090, endMs: 11680 },
  3: { startMs: 11680, endMs: 16300 },
});

describe('Timeline', () => {
  it('locates the verse for an absolute position', () => {
    expect(verseAtPosition(fatiha, 100, 1, 3)).toBe(1);
    expect(verseAtPosition(fatiha, 6090, 1, 3)).toBe(2);
    expect(verseAtPosition(fatiha, 16299, 1, 3)).toBe(3);
    expect(verseAtPosition(fatiha, 16300, 1, 3)).toBeNull();
    expect(verseAtPosition(fatiha, 7000, 1, 1)).toBeNull();
  });

  it('computes segment durations with a safe floor', () => {
    expect(segmentDurationMs(fatiha, 2)).toBe(5590);
    expect(segmentDurationMs(fatiha, 99)).toBe(1);
    expect(segmentDurationMs(null, 1)).toBe(1);
  });

  it('updates per-verse durations immutably and ignores tiny changes', () => {
    const t = makePerVerseTimeline('abdulbasit', 112, 4);
    const t2 = withVerseDuration(t, 2, 3200);
    expect(t2).not.toBe(t);
    expect(t2.segments[2].endMs).toBe(3200);
    expect(withVerseDuration(t2, 2, 3210)).toBe(t2);
  });

  it('rescales estimated single-file timelines to the real duration', () => {
    const est = makeTimeline('x', 1, 'single-file', 'estimated', { 1: { startMs: 0, endMs: 50 }, 2: { startMs: 50, endMs: 100 } });
    const scaled = rescaleToDuration(est, 1000);
    expect(scaled.segments[2].endMs).toBe(1000);
    expect(scaled.segments[1].endMs).toBe(500);
    expect(rescaleToDuration(fatiha, 1000)).toBe(fatiha); // bundled: untouched
  });

  it('prefers higher provenance and keeps current on ties', () => {
    const exact = { ...fatiha, source: 'exact' as const };
    const estimated = { ...fatiha, source: 'estimated' as const };
    expect(preferTimeline(fatiha, exact)).toBe(exact);
    expect(preferTimeline(fatiha, estimated)).toBe(fatiha);
    expect(preferTimeline(fatiha, { ...fatiha })).toBe(fatiha);
    expect(preferTimeline(null, exact)).toBe(exact);
  });
});
