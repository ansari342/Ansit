/**
 * Pure Hifz Ladder plan builder (no React, no storage) — unit-tested.
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
  isCombined: boolean;
}

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
    for (let v = from; v <= to; v++) {
      learn(v);
      const learned = v - from + 1;
      if (learned % 2 === 0) combine(v - 1, v);
      if (learned % 4 === 0) combine(v - 3, v);
    }
    const total = to - from + 1;
    if (total > 1 && total % 2 !== 0) combine(Math.max(from, to - 2), to);
    if (total > 2) combine(from, to);
  }
  return steps;
}

export function describeStep(step: LadderStep): string {
  const range = step.fromVerse === step.toVerse ? `v${step.fromVerse}` : `v${step.fromVerse}–${step.toVerse}`;
  return `${step.kind === 'listen' ? 'Listen' : 'Recite'} ${range} ×${step.reps}`;
}

export function formatVerseRange(step: LadderStep): string {
  return step.fromVerse === step.toVerse ? `Verse ${step.fromVerse}` : `Verses ${step.fromVerse}–${step.toVerse}`;
}
