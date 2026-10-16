import AsyncStorage from '@react-native-async-storage/async-storage';
import { AyahTiming } from '../data/reciterTimings';
import { LadderConfig, LadderStep, buildLadderPlan } from '../core/ladderPlan';

export type { LadderConfig, LadderStep, LadderStepKind } from '../core/ladderPlan';
export { buildLadderPlan, describeStep, formatVerseRange } from '../core/ladderPlan';

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
