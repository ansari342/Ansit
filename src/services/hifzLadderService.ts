import AsyncStorage from '@react-native-async-storage/async-storage';
import { AyahTiming } from '../data/reciterTimings';

/**
 * Hifz Ladder: listen a new verse N times, recite it alone M times, then combine with everything
 * learned so far (listen C times, recite R times), and climb to the next verse.
 */
export interface LadderConfig {
  listenNew: number;
  reciteNew: number;
  listenCombined: number;
  reciteCombined: number;
  combineStyle: 'cumulative' | 'chunked';
  reciteTiming: 'auto' | 'tap';
}

export type LadderStepKind = 'listen' | 'recite';

export interface LadderStep {
  index: number;
  kind: LadderStepKind;
  fromVerse: number;
  toVerse: number;
  reps: number;
  /** True for steps that review an accumulated passage rather than a single new verse. */
  isCombined: boolean;
}

export interface LadderProgress {
  key: string;
  surahNumber: number;
  fromVerse: number;
  toVerse: number;
  reciterId: string;
  config: LadderConfig;
  stepIndex: number;
  repsDone: number;
  completed: boolean;
  updatedAt: number;
}

export const LADDER_PRESETS: { id: string; label: string; detail: string; config: LadderConfig }[] = [
  {
    id: 'classic',
    label: 'Classic',
    detail: '10 · 3 · 5 · 3',
    config: { listenNew: 10, reciteNew: 3, listenCombined: 5, reciteCombined: 3, combineStyle: 'cumulative', reciteTiming: 'auto' },
  },
  {
    id: 'quick',
    label: 'Quick',
    detail: '5 · 2 · 3 · 2',
    config: { listenNew: 5, reciteNew: 2, listenCombined: 3, reciteCombined: 2, combineStyle: 'cumulative', reciteTiming: 'auto' },
  },
  {
    id: 'deep',
    label: 'Deep',
    detail: '15 · 5 · 7 · 3',
    config: { listenNew: 15, reciteNew: 5, listenCombined: 7, reciteCombined: 3, combineStyle: 'cumulative', reciteTiming: 'auto' },
  },
];

export const DEFAULT_LADDER_CONFIG: LadderConfig = LADDER_PRESETS[0].config;

const LAST_CONFIG_KEY = '@aya_hifz_ladder_last_config_v1';
const progressKey = (surah: number, from: number, to: number) => `@aya_hifz_ladder_progress_v1_${surah}_${from}_${to}`;

/** Expands the four numbers into the full ordered step list for a verse range. */
export function buildLadderPlan(fromVerse: number, toVerse: number, config: LadderConfig): LadderStep[] {
  const steps: LadderStep[] = [];
  const push = (kind: LadderStepKind, a: number, b: number, reps: number, isCombined: boolean) => {
    if (reps <= 0) return;
    steps.push({ index: steps.length, kind, fromVerse: a, toVerse: b, reps, isCombined });
  };
  const learn = (v: number) => {
    push('listen', v, v, config.listenNew, false);
    push('recite', v, v, config.reciteNew, false);
  };
  const combine = (a: number, b: number) => {
    push('listen', a, b, config.listenCombined, true);
    push('recite', a, b, config.reciteCombined, true);
  };

  const from = Math.min(fromVerse, toVerse);
  const to = Math.max(fromVerse, toVerse);

  if (config.combineStyle === 'cumulative') {
    for (let v = from; v <= to; v++) {
      learn(v);
      if (v > from) combine(from, v);
    }
  } else {
    // Chunked: pairs, then groups of four, then the whole passage
    for (let v = from; v <= to; v++) {
      learn(v);
      const learned = v - from + 1;
      if (learned % 2 === 0) combine(v - 1, v);
      if (learned % 4 === 0) combine(v - 3, v);
    }
    const total = to - from + 1;
    if (total > 1 && total % 4 !== 0 && total % 2 !== 0) {
      // Odd tail: fold the last verse into a short review of the final chunk
      combine(Math.max(from, to - 2), to);
    }
    if (total > 2) combine(from, to);
  }
  return steps;
}

export function estimatePlanDurationMs(
  plan: LadderStep[],
  verseTimings: Record<number, AyahTiming>,
  fallbackVerseMs: number = 6000
): number {
  const verseMs = (v: number) => {
    const t = verseTimings[v];
    return t ? Math.max(500, t.endMs - t.startMs) : fallbackVerseMs;
  };
  let total = 0;
  for (const s of plan) {
    let rangeMs = 0;
    for (let v = s.fromVerse; v <= s.toVerse; v++) rangeMs += verseMs(v);
    total += s.reps * (s.kind === 'listen' ? rangeMs : rangeMs * 1.3);
  }
  return total;
}

/** Duration allowed for one recitation of a step's range in 'auto' timing mode (1.3× the recording). */
export function reciteWindowMs(step: LadderStep, verseTimings: Record<number, AyahTiming>): number {
  let rangeMs = 0;
  for (let v = step.fromVerse; v <= step.toVerse; v++) {
    const t = verseTimings[v];
    rangeMs += t ? Math.max(1500, t.endMs - t.startMs) : 6000;
  }
  return Math.round(rangeMs * 1.3);
}

export function describeStep(step: LadderStep): string {
  const range = step.fromVerse === step.toVerse ? `v${step.fromVerse}` : `v${step.fromVerse}–${step.toVerse}`;
  return `${step.kind === 'listen' ? 'Listen' : 'Recite'} ${range} ×${step.reps}`;
}

export function formatVerseRange(step: LadderStep): string {
  return step.fromVerse === step.toVerse
    ? `Verse ${step.fromVerse}`
    : `Verses ${step.fromVerse}–${step.toVerse}`;
}

// ---- Persistence ----

export async function saveLastLadderConfig(config: LadderConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_CONFIG_KEY, JSON.stringify(config));
  } catch (e) {}
}

export async function getLastLadderConfig(): Promise<LadderConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_CONFIG_KEY);
    return raw ? { ...DEFAULT_LADDER_CONFIG, ...JSON.parse(raw) } : null;
  } catch (e) {
    return null;
  }
}

export async function saveLadderProgress(progress: Omit<LadderProgress, 'key' | 'updatedAt'>): Promise<void> {
  try {
    const key = progressKey(progress.surahNumber, progress.fromVerse, progress.toVerse);
    const full: LadderProgress = { ...progress, key, updatedAt: Date.now() };
    await AsyncStorage.setItem(key, JSON.stringify(full));
  } catch (e) {}
}

export async function getLadderProgress(surah: number, from: number, to: number): Promise<LadderProgress | null> {
  try {
    const raw = await AsyncStorage.getItem(progressKey(surah, from, to));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LadderProgress;
    return parsed && typeof parsed.stepIndex === 'number' ? parsed : null;
  } catch (e) {
    return null;
  }
}

export async function clearLadderProgress(surah: number, from: number, to: number): Promise<void> {
  try {
    await AsyncStorage.removeItem(progressKey(surah, from, to));
  } catch (e) {}
}
