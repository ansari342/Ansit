/**
 * reciteTracker.ts — Tarteel-style live word-by-word Quran recitation follower
 * and automatic mistake detector (`forgot` | `wrong` | `tajweed`).
 *
 * Pure, dependency-free core module with two complementary signal paths:
 * 1) Live Arabic ASR transcript alignment (normalizes Uthmanic orthography, strips tashkeel,
 *    matches spoken tokens against expected verse words via edit-distance + lookahead).
 * 2) Acoustic vocal-burst + Tajweed duration cadence tracker (advances word-by-word from
 *    voiced speech bursts when ASR lags or is unavailable, and flags `forgot` on long
 *    hesitations and `tajweed` on rushed Madd/Ghunnah words).
 */

export type AutoSlipReason = 'forgot' | 'wrong' | 'tajweed';

export interface AutoWordMark {
  wordIndex: number;
  reason: AutoSlipReason;
}

export interface WordExpectation {
  index: number;
  raw: string;
  normalized: string;
  /** Expected duration in ms from the reciter's timing table (or phonetic weight). */
  expectedDurationMs: number;
  /** True if this word contains a long vowel / Madd sign or Shaddah requiring elongation. */
  hasTajweedElongation: boolean;
}

/**
 * Normalizes Uthmanic or standard Arabic text into a canonical unvocalized consonant skeleton
 * so speech recognizer output (`ar-SA`) and Uthmanic script match reliably:
 * - Removes tashkeel (harakat), superscript alif (`\u0670`) → `ا`, waqf marks, tatweel
 * - Normalizes Alif variants (`أ إ آ ٱ`) → `ا`
 * - Normalizes Alif Maqsurah (`ى`) → `ي`, Ta Marbutah (`ة`) → `ه`, Hamza forms (`ؤ ئ ء`) → ``
 */
export function normalizeArabicWord(word: string): string {
  if (!word) return '';
  return (
    word
      // Convert dagger alif (superscript alif \u0670) to standard alif before stripping diacritics
      .replace(/\u0670/g, 'ا')
      // Strip Quranic annotation marks, harakat, sukun, shaddah, maddah, small letters
      .replace(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED\u08D4-\u08FF\u0640]/g, '')
      // Normalize alif variants (hamza above/below, madda, wasla)
      .replace(/[أإآٱ]/g, 'ا')
      // Normalize alif maqsura to ya
      .replace(/ى/g, 'ي')
      // Normalize ta marbuta to ha
      .replace(/ة/g, 'ه')
      // Normalize waw/ya with hamza
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      // Remove standalone hamza & punctuation
      .replace(/[ءٕٔ﴿﴾0-9٠-٩.,؛،؟!"]/g, '')
      // Collapse duplicate alifs created by dagger alif next to alif
      .replace(/اا+/g, 'ا')
      .trim()
  );
}

/**
 * Checks whether an Uthmanic word carries obligatory/recommended elongation (Madd `ٓ` `\u0653`,
 * dagger alif `\u0670`, shaddah `\u0651` on ن/م for Ghunnah, or long vowel letters).
 */
export function hasElongationFeature(rawWord: string): boolean {
  // Maddah sign (\u0653), Shaddah on Nun/Meem (Ghunnah), or Superscript Alif (\u0670)
  if (/[\u0653\u0670]/.test(rawWord)) return true;
  if (/[نم]\u0651/.test(rawWord)) return true;
  return false;
}

/**
 * Levenshtein edit distance between two normalized Arabic strings.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Normalized similarity in [0, 1] between two Arabic words.
 * Also accounts for common prefix attachment (e.g., `و` or `ال` split/merged by ASR).
 */
export function arabicWordSimilarity(expectedRaw: string, spokenRaw: string): number {
  const exp = normalizeArabicWord(expectedRaw);
  const spk = normalizeArabicWord(spokenRaw);
  if (!exp || !spk) return 0;
  if (exp === spk) return 1;

  // Check if one is a prefix/root match of the other (e.g. ASR drops leading Al- or Wa-)
  const stripAl = (s: string) => s.replace(/^و?ال/, '');
  if (stripAl(exp) === stripAl(spk) && stripAl(exp).length >= 2) {
    return 0.92;
  }

  const maxLen = Math.max(exp.length, spk.length);
  const dist = editDistance(exp, spk);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Builds per-word expectations from the verse's Uthmanic words and optional word timings.
 */
export function buildWordExpectations(
  words: string[],
  wordTimings?: { startMs: number; endMs: number }[]
): WordExpectation[] {
  const weights = words.map(w => Math.max(2, normalizeArabicWord(w).length));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const fallbackTotalMs = Math.max(2400, words.length * 650);

  return words.map((raw, index) => {
    const timing = wordTimings?.[index];
    const expectedDurationMs =
      timing && timing.endMs > timing.startMs
        ? timing.endMs - timing.startMs
        : Math.round((weights[index] / totalWeight) * fallbackTotalMs);

    return {
      index,
      raw,
      normalized: normalizeArabicWord(raw),
      expectedDurationMs: Math.max(280, expectedDurationMs),
      hasTajweedElongation: hasElongationFeature(raw),
    };
  });
}

export interface TranscriptAlignmentResult {
  /** Number of verse words revealed so far (0 .. words.length). */
  revealedCount: number;
  /** Marks detected from ASR transcript mismatches or skipped words. */
  marks: AutoWordMark[];
}

/**
 * Aligns a live partial/final Arabic ASR transcript against the verse's expected words.
 * - Matches each spoken token to the current expected word (or looks ahead 1–2 words if the
 *   reciter skipped/forgot a word).
 * - If a spoken token matches word `cursor + 1` or `cursor + 2`, the skipped word at `cursor`
 *   is automatically marked `'forgot'` and the cursor advances!
 * - If a spoken token at `cursor` is phonetically distant (`similarity < 0.55`) and followed by
 *   the next word, `cursor` is marked `'wrong'`.
 */
export function alignTranscriptToVerse(
  expectedWords: string[],
  transcript: string
): TranscriptAlignmentResult {
  const tokens = transcript
    .trim()
    .split(/\s+/)
    .map(t => normalizeArabicWord(t))
    .filter(Boolean);

  if (tokens.length === 0 || expectedWords.length === 0) {
    return { revealedCount: 0, marks: [] };
  }

  let cursor = 0;
  const marksMap = new Map<number, AutoSlipReason>();

  let tIdx = 0;
  while (tIdx < tokens.length && cursor < expectedWords.length) {
    const spoken = tokens[tIdx];
    const simCurrent = arabicWordSimilarity(expectedWords[cursor], spoken);

    // 1. Direct match on current expected word
    if (simCurrent >= 0.58) {
      cursor++;
      tIdx++;
      continue;
    }

    // 2. Check two-token merged word (e.g. ASR split "يَبْنَؤُمَّ" or "أَلَّا")
    if (tIdx + 1 < tokens.length) {
      const merged = spoken + tokens[tIdx + 1];
      if (arabicWordSimilarity(expectedWords[cursor], merged) >= 0.62) {
        cursor++;
        tIdx += 2;
        continue;
      }
    }

    // 3. Lookahead +1: user skipped/forgot `cursor` and said `cursor + 1`
    if (cursor + 1 < expectedWords.length) {
      const simNext1 = arabicWordSimilarity(expectedWords[cursor + 1], spoken);
      if (simNext1 >= 0.68) {
        marksMap.set(cursor, 'forgot');
        cursor += 2;
        tIdx++;
        continue;
      }
    }

    // 4. Lookahead +2: user skipped 2 words or said wrong word then moved on
    if (cursor + 2 < expectedWords.length) {
      const simNext2 = arabicWordSimilarity(expectedWords[cursor + 2], spoken);
      if (simNext2 >= 0.72) {
        marksMap.set(cursor, 'forgot');
        marksMap.set(cursor + 1, 'forgot');
        cursor += 3;
        tIdx++;
        continue;
      }
    }

    // 5. If there are more spoken tokens after this one and this token didn't match,
    //    the user likely mispronounced / said a wrong word at `cursor`.
    if (tIdx + 1 < tokens.length && cursor + 1 < expectedWords.length) {
      const nextSpokenSim = arabicWordSimilarity(expectedWords[cursor + 1], tokens[tIdx + 1]);
      if (nextSpokenSim >= 0.6) {
        marksMap.set(cursor, simCurrent >= 0.35 ? 'tajweed' : 'wrong');
        cursor++;
        tIdx++;
        continue;
      }
    }

    // Otherwise advance token index (could be breath/noise word)
    tIdx++;
  }

  const marks: AutoWordMark[] = Array.from(marksMap.entries()).map(([wordIndex, reason]) => ({
    wordIndex,
    reason,
  }));

  return {
    revealedCount: Math.min(expectedWords.length, cursor),
    marks,
  };
}

export interface LiveReciteTrackerState {
  /** Number of words revealed so far (0 .. expectations.length). */
  revealedCount: number;
  /** Currently active word index being spoken (0 .. expectations.length - 1). */
  activeWordIndex: number;
  /** Cumulative voiced ms spent on the current word. */
  currentWordVoicedMs: number;
  /** Cumulative silence ms before/during the current word. */
  currentWordSilenceMs: number;
  /** Whether the user has started speaking in this take. */
  hasStartedSpeaking: boolean;
  /** Automatically detected slips so far. */
  marks: AutoWordMark[];
}

export function createInitialTrackerState(): LiveReciteTrackerState {
  return {
    revealedCount: 0,
    activeWordIndex: 0,
    currentWordVoicedMs: 0,
    currentWordSilenceMs: 0,
    hasStartedSpeaking: false,
    marks: [],
  };
}

function upsertMark(marks: AutoWordMark[], wordIndex: number, reason: AutoSlipReason): AutoWordMark[] {
  const existing = marks.find(m => m.wordIndex === wordIndex);
  if (existing) {
    // Keep highest-priority slip ('forgot' > 'wrong' > 'tajweed')
    const rank: Record<AutoSlipReason, number> = { forgot: 3, wrong: 2, tajweed: 1 };
    if (rank[reason] <= rank[existing.reason]) return marks;
    return marks.map(m => (m.wordIndex === wordIndex ? { wordIndex, reason } : m));
  }
  return [...marks, { wordIndex, reason }];
}

/**
 * Steps the live acoustic cadence tracker by one envelope frame (`stepMs`, typically 100 ms).
 *
 * Works seamlessly alongside `alignTranscriptToVerse`:
 * - When the user speaks (`db >= voiceThresholdDb`), accumulates `currentWordVoicedMs`.
 * - Once `currentWordVoicedMs` reaches ~58% of the word's expected duration (or a syllable dip
 *   occurs after 42% of expected duration), the word fills in (Tarteel-style) and advances to the
 *   next word!
 * - If the user pauses for >= 1500 ms before a word after starting recitation, automatically
 *   marks that word as `'forgot'` (hesitation/memory slip).
 * - If a word with a Madd/Ghunnah elongation (`hasTajweedElongation`) is rushed in less than 42%
 *   of its expected duration before a pause/dip, flags `'tajweed'`.
 */
export function stepAcousticTracker(
  prev: LiveReciteTrackerState,
  expectations: WordExpectation[],
  db: number,
  stepMs: number = 100,
  voiceThresholdDb: number = -42
): LiveReciteTrackerState {
  if (expectations.length === 0 || prev.revealedCount >= expectations.length) {
    return prev;
  }

  const idx = prev.revealedCount;
  const exp = expectations[idx];
  const isVoiced = db >= voiceThresholdDb;
  const isSyllableDip = db < voiceThresholdDb + 4;

  let hasStarted = prev.hasStartedSpeaking || isVoiced;
  let voicedMs = prev.currentWordVoicedMs;
  let silenceMs = prev.currentWordSilenceMs;
  let marks = prev.marks;
  let revealedCount = prev.revealedCount;

  if (!hasStarted) {
    return prev;
  }

  if (isVoiced) {
    voicedMs += stepMs;
    silenceMs = 0;

    // Advance when voiced energy reaches ~62% of the word's expected duration
    const targetVoicedMs = Math.max(240, Math.min(950, exp.expectedDurationMs * 0.62));
    if (voicedMs >= targetVoicedMs) {
      revealedCount = idx + 1;
      voicedMs = 0;
      silenceMs = 0;
    }
  } else {
    silenceMs += stepMs;

    // If user already spoke part of the word (>= 180 ms) and paused at a word boundary
    if (voicedMs >= 180 && isSyllableDip) {
      // Check if this word required Madd / Ghunnah elongation and was cut far too short
      if (
        exp.hasTajweedElongation &&
        exp.expectedDurationMs >= 550 &&
        voicedMs < exp.expectedDurationMs * 0.42
      ) {
        marks = upsertMark(marks, idx, 'tajweed');
      }
      revealedCount = idx + 1;
      voicedMs = 0;
      silenceMs = 0;
    } else if (silenceMs >= 1500) {
      // Long mid-ayah hesitation (>= 1.5s silence) -> automatically flag 'forgot'
      marks = upsertMark(marks, idx, 'forgot');
    }
  }

  return {
    revealedCount,
    activeWordIndex: Math.min(expectations.length - 1, revealedCount),
    currentWordVoicedMs: voicedMs,
    currentWordSilenceMs: silenceMs,
    hasStartedSpeaking: hasStarted,
    marks,
  };
}

/**
 * Merges live ASR transcript alignment into the acoustic tracker state so whichever signal
 * is further ahead (or catches a specific word substitution) updates the revealed words and marks.
 */
export function mergeTranscriptIntoTracker(
  prev: LiveReciteTrackerState,
  expectations: WordExpectation[],
  transcript: string
): LiveReciteTrackerState {
  if (!transcript.trim() || expectations.length === 0) return prev;
  const aligned = alignTranscriptToVerse(
    expectations.map(e => e.raw),
    transcript
  );

  let marks = prev.marks;
  for (const m of aligned.marks) {
    marks = upsertMark(marks, m.wordIndex, m.reason);
  }

  const nextRevealed = Math.max(prev.revealedCount, aligned.revealedCount);
  const advanced = nextRevealed > prev.revealedCount;

  return {
    ...prev,
    revealedCount: nextRevealed,
    activeWordIndex: Math.min(expectations.length - 1, nextRevealed),
    currentWordVoicedMs: advanced ? 0 : prev.currentWordVoicedMs,
    currentWordSilenceMs: advanced ? 0 : prev.currentWordSilenceMs,
    hasStartedSpeaking: prev.hasStartedSpeaking || aligned.revealedCount > 0,
    marks,
  };
}

/**
 * Post-take audit when the user stops recording:
 * - Any trailing words that were never reached before stopping are marked `'forgot'`
 *   (if the user recited at least 1 word).
 * - Compares overall take envelope pauses and word pacing to catch any missed slips.
 */
export function finalizeTakeAutoMarks(
  state: LiveReciteTrackerState,
  expectations: WordExpectation[],
  envelope: number[],
  stepMs: number = 100
): { revealedCount: number; marks: AutoWordMark[] } {
  let marks = [...state.marks];
  const totalWords = expectations.length;
  if (totalWords === 0) return { revealedCount: 0, marks: [] };

  // 1. If user stopped early before finishing the verse (and spoke at least 1 word),
  //    mark unrecited trailing words as 'forgot'
  if (state.hasStartedSpeaking && state.revealedCount > 0 && state.revealedCount < totalWords) {
    for (let i = state.revealedCount; i < totalWords; i++) {
      marks = upsertMark(marks, i, 'forgot');
    }
  }

  // 2. Scan the amplitude envelope for internal pauses >= 1.2s and map them to the corresponding word index
  if (envelope.length >= 12) {
    const totalExpectedMs = expectations.reduce((s, e) => s + e.expectedDurationMs, 0) || 1;
    let firstVoiced = -1;
    let lastVoiced = -1;
    for (let i = 0; i < envelope.length; i++) {
      if (envelope[i] >= -44) {
        if (firstVoiced === -1) firstVoiced = i;
        lastVoiced = i;
      }
    }

    if (firstVoiced !== -1 && lastVoiced > firstVoiced + 5) {
      const activeSpanFrames = Math.max(1, lastVoiced - firstVoiced);
      let i = firstVoiced;
      while (i <= lastVoiced) {
        if (envelope[i] < -45) {
          let j = i;
          while (j <= lastVoiced && envelope[j] < -45) j++;
          const pauseMs = (j - i) * stepMs;
          if (pauseMs >= 1200) {
            const relProgress = (i - firstVoiced) / activeSpanFrames;
            const targetMs = relProgress * totalExpectedMs;
            let acc = 0;
            let wordIdx = 0;
            for (let k = 0; k < expectations.length; k++) {
              acc += expectations[k].expectedDurationMs;
              if (targetMs <= acc) {
                wordIdx = k;
                break;
              }
            }
            marks = upsertMark(marks, wordIdx, 'forgot');
          }
          i = j;
        } else {
          i++;
        }
      }

      // 3. Check if overall recitation was severely rushed (< 48% of expected duration on Tajweed words)
      const activeDurationMs = activeSpanFrames * stepMs;
      if (activeDurationMs < totalExpectedMs * 0.48) {
        const tajweedWord = expectations.find(e => e.hasTajweedElongation);
        if (tajweedWord) {
          marks = upsertMark(marks, tajweedWord.index, 'tajweed');
        }
      }
    }
  }

  return {
    revealedCount: totalWords,
    marks: marks.sort((a, b) => a.wordIndex - b.wordIndex),
  };
}
