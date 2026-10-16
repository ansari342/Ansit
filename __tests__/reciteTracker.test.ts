import {
  normalizeArabicWord,
  arabicWordSimilarity,
  buildWordExpectations,
  alignTranscriptToVerse,
  createInitialTrackerState,
  stepAcousticTracker,
  mergeTranscriptIntoTracker,
  finalizeTakeAutoMarks,
} from '../src/core/reciteTracker';

describe('reciteTracker (Tarteel-style live word fill & auto mistake detection)', () => {
  const fatiha2Words = ['ٱلْحَمْدُ', 'لِلَّهِ', 'رَبِّ', 'ٱلْعَٰلَمِينَ'];

  test('normalizes Uthmanic diacritics, alif wasla, and superscript alif', () => {
    expect(normalizeArabicWord('ٱلْحَمْدُ')).toBe('الحمد');
    expect(normalizeArabicWord('ٱلْعَٰلَمِينَ')).toBe('العالمين');
    expect(normalizeArabicWord('ٱلرَّحْمَٰنِ')).toBe('الرحمان');
  });

  test('computes high similarity between Uthmanic words and plain ASR Arabic words', () => {
    expect(arabicWordSimilarity('ٱلْحَمْدُ', 'الحمد')).toBe(1);
    expect(arabicWordSimilarity('ٱلْعَٰلَمِينَ', 'العالمين')).toBe(1);
    expect(arabicWordSimilarity('لِلَّهِ', 'لله')).toBe(1);
    expect(arabicWordSimilarity('رَبِّ', 'رب')).toBe(1);
  });

  test('reveals words sequentially when ASR transcript matches verse', () => {
    const partial1 = alignTranscriptToVerse(fatiha2Words, 'الحمد لله');
    expect(partial1.revealedCount).toBe(2);
    expect(partial1.marks).toEqual([]);

    const full = alignTranscriptToVerse(fatiha2Words, 'الحمد لله رب العالمين');
    expect(full.revealedCount).toBe(4);
    expect(full.marks).toEqual([]);
  });

  test('auto-marks skipped word as forgot when user jumps ahead to next word', () => {
    // User recites "الحمد لله العالمين" (skipped "رب")
    const res = alignTranscriptToVerse(fatiha2Words, 'الحمد لله العالمين');
    expect(res.revealedCount).toBe(4);
    expect(res.marks).toEqual([{ wordIndex: 2, reason: 'forgot' }]);
  });

  test('auto-marks substituted word as wrong when user says an unrelated word', () => {
    // User says "الحمد كتاب رب العالمين" ("كتاب" instead of "لله")
    const res = alignTranscriptToVerse(fatiha2Words, 'الحمد كتاب رب العالمين');
    expect(res.revealedCount).toBe(4);
    expect(res.marks).toEqual([{ wordIndex: 1, reason: 'wrong' }]);
  });

  test('advances word-by-word from acoustic vocal bursts and flags long hesitation as forgot', () => {
    const expectations = buildWordExpectations(fatiha2Words, [
      { startMs: 0, endMs: 500 },
      { startMs: 500, endMs: 1000 },
      { startMs: 1000, endMs: 1500 },
      { startMs: 1500, endMs: 2500 },
    ]);

    let state = createInitialTrackerState();
    // Speak word 0 (400 ms voiced)
    for (let i = 0; i < 4; i++) {
      state = stepAcousticTracker(state, expectations, -22, 100);
    }
    expect(state.revealedCount).toBe(1);

    // Hesitate for 1.6s before word 1 -> auto-flagged as 'forgot'
    for (let i = 0; i < 16; i++) {
      state = stepAcousticTracker(state, expectations, -60, 100);
    }
    expect(state.marks).toEqual([{ wordIndex: 1, reason: 'forgot' }]);
  });

  test('finalizeTakeAutoMarks marks unrecited trailing words as forgot if user stops mid-ayah', () => {
    const expectations = buildWordExpectations(fatiha2Words);
    let state = createInitialTrackerState();
    state = mergeTranscriptIntoTracker(state, expectations, 'الحمد لله');
    expect(state.revealedCount).toBe(2);

    const finalized = finalizeTakeAutoMarks(state, expectations, [-20, -20, -20, -20]);
    expect(finalized.marks).toEqual([
      { wordIndex: 2, reason: 'forgot' },
      { wordIndex: 3, reason: 'forgot' },
    ]);
  });
});
