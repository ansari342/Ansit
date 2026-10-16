/**
 * PlaybackEngine — a headless, pure state machine for Aya playback.
 *
 * It owns every decision about WHAT should happen (which verse, when to loop, when a ladder step
 * ends, when to pause) and emits Commands describing it. It never touches the audio player, React,
 * timers or storage; a host adapter runs the commands and feeds events back in.
 *
 *   events  → reduce(state, event) → { state, commands }
 *
 * Because it is pure it is unit-tested with a fake player, and every transition is deterministic:
 * no refs, no closures, no update-order bugs.
 */
import { LadderConfig, LadderStep, buildLadderPlan } from './ladderPlan';
import { Timeline, preferTimeline, segmentDurationMs, segmentFor, verseAtPosition } from './timeline';

export type LoopMode = 'range' | 'single' | 'off';

export interface EngineConfig {
  fromVerse: number;
  toVerse: number;
  mode: LoopMode;
  verseRepeatCount: number;
  delayBetweenVersesMs: number;
  /** Multiple-reciters mode: cycle reciter when the range (or single verse) completes. */
  cycleReciters: boolean;
  /** Pitch-monitor Auto-Echo: play each verse twice (reciter pass, then user pass). */
  echo: boolean;
}

export type LadderPhase = 'listen' | 'recite' | 'preview' | 'complete';

export interface LadderRuntime {
  config: LadderConfig;
  plan: LadderStep[];
  stepIndex: number;
  repsDone: number;
  phase: LadderPhase;
}

export interface EngineState {
  config: EngineConfig;
  timeline: Timeline | null;
  pendingTimeline: Timeline | null;
  verse: number;
  /** Position inside the current verse (ms). */
  positionMs: number;
  /** Duration of the current verse (ms). */
  durationMs: number;
  isPlaying: boolean;
  /** 1-based repeat iteration of the current verse. */
  playCount: number;
  echoPass: 1 | 2;
  /** True between deciding a transition and the host confirming playback resumed at the target. */
  transitioning: boolean;
  activeFrom: number;
  activeTo: number;
  ladder: LadderRuntime | null;
}

export type EngineEvent =
  | { type: 'LOAD'; config: EngineConfig; timeline: Timeline | null; ladder?: { config: LadderConfig; stepIndex?: number; repsDone?: number } | null }
  | { type: 'TIMELINE'; timeline: Timeline; immediate?: boolean }
  | { type: 'TICK'; positionMs: number; durationMs?: number; isPlaying: boolean }
  | { type: 'ENDED' }
  | { type: 'PLAY_STARTED'; verse: number }
  | { type: 'TOGGLE' }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'SEEK_VERSE'; verse: number; fraction: number }
  | { type: 'SET_CONFIG'; config: Partial<EngineConfig> }
  | { type: 'RECITER_CHANGED'; timeline: Timeline | null; startVerse: number }
  | { type: 'LADDER_COMPLETE_REP' }
  | { type: 'LADDER_HEAR_AGAIN' }
  | { type: 'LADDER_GOTO_STEP'; index: number }
  | { type: 'LADDER_RESTART' }
  | { type: 'LADDER_EXIT' };

export type Command =
  | { type: 'PLAY_VERSE'; verse: number; offsetMs: number }
  | { type: 'RESUME' }
  | { type: 'PAUSE' }
  | { type: 'AFTER_DELAY'; ms: number; commands: Command[] }
  | { type: 'NEXT_RECITER'; startVerse: number }
  | { type: 'HAPTIC'; kind: 'selection' | 'light' | 'success' | 'warning' }
  | { type: 'START_RECITE_TIMER'; ms: number }
  | { type: 'CLEAR_RECITE_TIMER' }
  | { type: 'PERSIST_LADDER'; completed: boolean }
  | { type: 'LADDER_EXITED' };

export const BOUNDARY_LEAD_MS = 120;
export const RECITE_WINDOW_FACTOR = 1.3;
/** Ticks that move the playhead less than this are coalesced to avoid re-rendering at 20 Hz. */
export const TICK_MIN_DELTA_MS = 60;

export const DEFAULT_CONFIG: EngineConfig = {
  fromVerse: 1,
  toVerse: 1,
  mode: 'range',
  verseRepeatCount: 1,
  delayBetweenVersesMs: 0,
  cycleReciters: false,
  echo: false,
};

export function initialState(): EngineState {
  return {
    config: DEFAULT_CONFIG,
    timeline: null,
    pendingTimeline: null,
    verse: 1,
    positionMs: 0,
    durationMs: 1,
    isPlaying: false,
    playCount: 1,
    echoPass: 1,
    transitioning: false,
    activeFrom: 1,
    activeTo: 1,
    ladder: null,
  };
}

type Result = { state: EngineState; commands: Command[] };

const ok = (state: EngineState, commands: Command[] = []): Result => ({ state, commands });

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function currentStep(s: EngineState): LadderStep | null {
  if (!s.ladder) return null;
  return s.ladder.plan[s.ladder.stepIndex] ?? null;
}

function rangeDurationMs(s: EngineState, from: number, to: number): number {
  let total = 0;
  for (let v = from; v <= to; v++) total += Math.max(1500, segmentDurationMs(s.timeline, v));
  return total;
}

/** Holding on a single verse: single mode, repeats, echo, or a one-verse ladder step. */
function holdsSingleVerse(s: EngineState): boolean {
  return s.config.mode === 'single' || s.config.verseRepeatCount > 1 || s.config.echo;
}

function applyPendingTimeline(s: EngineState): EngineState {
  if (!s.pendingTimeline) return s;
  return { ...s, timeline: preferTimeline(s.timeline, s.pendingTimeline), pendingTimeline: null };
}

/** Starts (or restarts) playback of a verse: sets transition flag and emits PLAY_VERSE. */
function go(s: EngineState, verse: number, offsetMs: number = 0, extra: Command[] = []): Result {
  const next: EngineState = {
    ...applyPendingTimeline(s),
    verse,
    positionMs: offsetMs,
    durationMs: segmentDurationMs(s.timeline, verse),
    transitioning: true,
    isPlaying: true,
  };
  return ok(next, [...extra, { type: 'PLAY_VERSE', verse, offsetMs }]);
}

/** Wraps PLAY_VERSE in the configured inter-verse delay (if any). */
function withDelay(s: EngineState, result: Result): Result {
  const ms = s.config.delayBetweenVersesMs;
  if (ms <= 0) return result;
  return ok({ ...result.state, isPlaying: false }, [{ type: 'PAUSE' }, { type: 'AFTER_DELAY', ms, commands: result.commands }]);
}

function pauseResult(s: EngineState, extra: Command[] = []): Result {
  return ok({ ...s, isPlaying: false, transitioning: false }, [...extra, { type: 'PAUSE' }]);
}

// ------------------------------------------------------------------------------------------
// Ladder helpers
// ------------------------------------------------------------------------------------------

function ladderStartStep(s: EngineState, index: number, repsDone: number = 0): Result {
  if (!s.ladder) return ok(s);
  const plan = s.ladder.plan;
  if (plan.length === 0) return ok(s);
  const stepIndex = clamp(index, 0, plan.length - 1);
  const step = plan[stepIndex];
  const base: EngineState = {
    ...s,
    activeFrom: step.fromVerse,
    activeTo: step.toVerse,
    playCount: 1,
    echoPass: 1,
    ladder: { ...s.ladder, stepIndex, repsDone: clamp(repsDone, 0, step.reps - 1), phase: step.kind === 'listen' ? 'listen' : 'recite' },
  };
  if (step.kind === 'listen') {
    const r = go(base, step.fromVerse);
    return ok(r.state, [{ type: 'CLEAR_RECITE_TIMER' }, ...r.commands, { type: 'PERSIST_LADDER', completed: false }]);
  }
  const reciteState: EngineState = { ...base, verse: step.fromVerse, positionMs: 0, durationMs: segmentDurationMs(s.timeline, step.fromVerse), isPlaying: false, transitioning: false };
  return ok(reciteState, [
    { type: 'PAUSE' },
    { type: 'HAPTIC', kind: 'warning' },
    ...reciteTimerCommands(reciteState),
    { type: 'PERSIST_LADDER', completed: false },
  ]);
}

function reciteTimerCommands(s: EngineState): Command[] {
  const step = currentStep(s);
  if (!s.ladder || !step) return [];
  if (s.ladder.config.reciteTiming !== 'auto') return [{ type: 'CLEAR_RECITE_TIMER' }];
  return [{ type: 'START_RECITE_TIMER', ms: Math.round(rangeDurationMs(s, step.fromVerse, step.toVerse) * RECITE_WINDOW_FACTOR) }];
}

function ladderAdvance(s: EngineState): Result {
  if (!s.ladder) return ok(s);
  if (s.ladder.stepIndex + 1 >= s.ladder.plan.length) {
    const done: EngineState = { ...s, isPlaying: false, transitioning: false, ladder: { ...s.ladder, phase: 'complete' } };
    return ok(done, [{ type: 'CLEAR_RECITE_TIMER' }, { type: 'PAUSE' }, { type: 'HAPTIC', kind: 'success' }, { type: 'PERSIST_LADDER', completed: true }]);
  }
  return ladderStartStep(s, s.ladder.stepIndex + 1, 0);
}

/** Called when a full pass over the active range finished. Returns null if the ladder is not involved. */
function ladderOnRangeFinished(s: EngineState): Result | null {
  const step = currentStep(s);
  if (!s.ladder || !step) return null;

  if (s.ladder.phase === 'preview') {
    const back: EngineState = { ...s, isPlaying: false, transitioning: false, verse: step.fromVerse, positionMs: 0, ladder: { ...s.ladder, phase: 'recite' } };
    return ok(back, [{ type: 'PAUSE' }, ...reciteTimerCommands(back)]);
  }
  if (s.ladder.phase !== 'listen') return null;

  const repsDone = s.ladder.repsDone + 1;
  if (repsDone < step.reps) {
    const next: EngineState = { ...s, ladder: { ...s.ladder, repsDone } };
    const r = withDelay(next, go(next, step.fromVerse));
    return ok(r.state, [...r.commands, { type: 'PERSIST_LADDER', completed: false }]);
  }
  return ladderAdvance({ ...s, ladder: { ...s.ladder, repsDone } });
}

// ------------------------------------------------------------------------------------------
// Finish handling (shared by single-file boundary detection and per-verse ENDED)
// ------------------------------------------------------------------------------------------

function onVerseFinished(s0: EngineState): Result {
  const s = applyPendingTimeline(s0);
  const { config } = s;

  // Auto-Echo: reciter pass → user pass on the same verse
  if (config.echo && s.echoPass === 1) {
    return go({ ...s, echoPass: 2 }, s.verse);
  }
  const base: EngineState = { ...s, echoPass: 1 };

  // Per-verse repeats
  if (base.playCount < config.verseRepeatCount) {
    return withDelay(base, go({ ...base, playCount: base.playCount + 1 }, base.verse));
  }
  const reset: EngineState = { ...base, playCount: 1 };

  if (config.mode === 'single' && !reset.ladder) {
    if (config.cycleReciters) return ok({ ...reset, transitioning: true }, [{ type: 'NEXT_RECITER', startVerse: reset.verse }]);
    return withDelay(reset, go(reset, reset.verse));
  }

  if (reset.verse < reset.activeTo) {
    return withDelay(reset, go(reset, reset.verse + 1, 0, [{ type: 'HAPTIC', kind: 'selection' }]));
  }

  // Range finished
  const ladderResult = ladderOnRangeFinished(reset);
  if (ladderResult) return ladderResult;

  if (config.mode === 'off') return pauseResult({ ...reset, positionMs: reset.durationMs });
  if (config.cycleReciters) return ok({ ...reset, transitioning: true }, [{ type: 'NEXT_RECITER', startVerse: reset.activeFrom }]);
  return withDelay(reset, go(reset, reset.activeFrom));
}

// ------------------------------------------------------------------------------------------
// Reducer
// ------------------------------------------------------------------------------------------

export function reduce(s: EngineState, e: EngineEvent): Result {
  switch (e.type) {
    case 'LOAD': {
      const from = Math.min(e.config.fromVerse, e.config.toVerse);
      const to = Math.max(e.config.fromVerse, e.config.toVerse);
      const config = { ...e.config, fromVerse: from, toVerse: to };
      const loaded: EngineState = {
        ...initialState(),
        config,
        timeline: e.timeline,
        verse: from,
        activeFrom: from,
        activeTo: to,
        durationMs: segmentDurationMs(e.timeline, from),
        ladder: e.ladder
          ? { config: e.ladder.config, plan: buildLadderPlan(from, to, e.ladder.config), stepIndex: 0, repsDone: 0, phase: 'listen' }
          : null,
      };
      if (loaded.ladder) return ladderStartStep(loaded, e.ladder?.stepIndex ?? 0, e.ladder?.repsDone ?? 0);
      return go(loaded, from);
    }

    case 'TIMELINE': {
      if (e.immediate || !s.isPlaying || s.transitioning) {
        const timeline = preferTimeline(s.timeline, e.timeline);
        return ok({ ...s, timeline, pendingTimeline: null, durationMs: segmentDurationMs(timeline, s.verse) });
      }
      return ok({ ...s, pendingTimeline: preferTimeline(s.pendingTimeline ?? s.timeline, e.timeline) });
    }

    case 'PLAY_STARTED': {
      if (e.verse !== s.verse) return ok(s);
      return ok({ ...s, transitioning: false, isPlaying: true });
    }

    case 'TICK': {
      if (s.transitioning) return ok(s);
      if (s.ladder && (s.ladder.phase === 'recite' || s.ladder.phase === 'complete')) return ok(s);
      if (!e.isPlaying) {
        return ok(s.isPlaying ? { ...s, isPlaying: false } : s);
      }
      const t = s.timeline;

      if (!t || t.kind === 'per-verse') {
        const durationMs = e.durationMs && e.durationMs > 1 ? e.durationMs : s.durationMs;
        const positionMs = clamp(e.positionMs, 0, durationMs);
        if (s.isPlaying && durationMs === s.durationMs && Math.abs(positionMs - s.positionMs) < TICK_MIN_DELTA_MS) return ok(s);
        return ok({ ...s, isPlaying: true, positionMs, durationMs });
      }

      // single-file: absolute position → verse + boundary checks
      const abs = e.positionMs;
      let verse = s.verse;
      let playCount = s.playCount;
      const commands: Command[] = [];
      const seg = segmentFor(t, verse);

      if (holdsSingleVerse(s) || (s.ladder && s.activeFrom === s.activeTo)) {
        if (seg && abs >= seg.endMs - BOUNDARY_LEAD_MS) {
          return onVerseFinished({ ...s, isPlaying: true, positionMs: segmentDurationMs(t, verse) });
        }
      } else {
        const endSeg = segmentFor(t, s.activeTo);
        if (endSeg && abs >= endSeg.endMs - BOUNDARY_LEAD_MS) {
          return onVerseFinished({ ...s, isPlaying: true, verse: s.activeTo, positionMs: segmentDurationMs(t, s.activeTo), durationMs: segmentDurationMs(t, s.activeTo) });
        }
        const located = verseAtPosition(t, abs, s.activeFrom, s.activeTo);
        if (located !== null && located !== verse) {
          verse = located;
          playCount = 1;
          commands.push({ type: 'HAPTIC', kind: 'selection' });
        }
      }

      const vSeg = segmentFor(t, verse);
      const durationMs = vSeg ? Math.max(1, vSeg.endMs - vSeg.startMs) : s.durationMs;
      const positionMs = vSeg ? clamp(abs - vSeg.startMs, 0, durationMs) : s.positionMs;
      if (
        commands.length === 0 &&
        s.isPlaying &&
        verse === s.verse &&
        durationMs === s.durationMs &&
        Math.abs(positionMs - s.positionMs) < TICK_MIN_DELTA_MS
      ) {
        return ok(s);
      }
      return ok({ ...s, isPlaying: true, verse, playCount, positionMs, durationMs }, commands);
    }

    case 'ENDED': {
      if (s.transitioning) return ok(s);
      if (s.ladder && (s.ladder.phase === 'recite' || s.ladder.phase === 'complete')) return ok(s);
      return onVerseFinished({ ...s, positionMs: s.durationMs });
    }

    case 'TOGGLE':
      return s.isPlaying ? reduce(s, { type: 'PAUSE' }) : reduce(s, { type: 'PLAY' });

    case 'PAUSE':
      if (s.ladder?.phase === 'recite') return ok(s);
      return pauseResult(s);

    case 'PLAY': {
      if (s.ladder?.phase === 'recite') return reduce(s, { type: 'LADDER_HEAR_AGAIN' });
      if (s.ladder?.phase === 'complete') return ok(s);
      return ok({ ...s, isPlaying: true }, [{ type: 'RESUME' }]);
    }

    case 'NEXT': {
      if (s.ladder) {
        if (s.ladder.phase === 'complete') return ok(s);
        return s.ladder.stepIndex + 1 >= s.ladder.plan.length ? ladderAdvance(s) : ladderStartStep(s, s.ladder.stepIndex + 1);
      }
      const target = clamp(s.verse + 1, s.activeFrom, s.activeTo);
      return go({ ...s, playCount: 1, echoPass: 1 }, target, 0, [{ type: 'HAPTIC', kind: 'light' }]);
    }

    case 'PREV': {
      if (s.ladder) {
        if (s.ladder.phase === 'complete') return ladderStartStep(s, s.ladder.plan.length - 1);
        return ladderStartStep(s, Math.max(0, s.ladder.stepIndex - 1));
      }
      const target = clamp(s.verse - 1, s.activeFrom, s.activeTo);
      return go({ ...s, playCount: 1, echoPass: 1 }, target, 0, [{ type: 'HAPTIC', kind: 'light' }]);
    }

    case 'SEEK_VERSE': {
      if (s.ladder?.phase === 'recite' || s.ladder?.phase === 'complete') return ok(s);
      const verse = clamp(e.verse, s.activeFrom, s.activeTo);
      const offset = Math.round(clamp(e.fraction, 0, 0.995) * segmentDurationMs(s.timeline, verse));
      return go({ ...s, playCount: verse === s.verse ? s.playCount : 1 }, verse, offset);
    }

    case 'SET_CONFIG': {
      const config = { ...s.config, ...e.config };
      const from = Math.min(config.fromVerse, config.toVerse);
      const to = Math.max(config.fromVerse, config.toVerse);
      const next: EngineState = { ...s, config: { ...config, fromVerse: from, toVerse: to } };
      if (!next.ladder) {
        next.activeFrom = from;
        next.activeTo = to;
      }
      return ok(next);
    }

    case 'RECITER_CHANGED': {
      const withTimeline: EngineState = { ...s, timeline: e.timeline, pendingTimeline: null, playCount: 1, echoPass: 1 };
      return go(withTimeline, clamp(e.startVerse, s.activeFrom, s.activeTo));
    }

    case 'LADDER_COMPLETE_REP': {
      const step = currentStep(s);
      if (!s.ladder || !step || s.ladder.phase !== 'recite') return ok(s);
      const repsDone = s.ladder.repsDone + 1;
      if (repsDone >= step.reps) return ladderAdvance({ ...s, ladder: { ...s.ladder, repsDone } });
      const next: EngineState = { ...s, ladder: { ...s.ladder, repsDone } };
      return ok(next, [{ type: 'HAPTIC', kind: 'light' }, ...reciteTimerCommands(next), { type: 'PERSIST_LADDER', completed: false }]);
    }

    case 'LADDER_HEAR_AGAIN': {
      const step = currentStep(s);
      if (!s.ladder || !step || s.ladder.phase !== 'recite') return ok(s);
      const r = go({ ...s, playCount: 1, ladder: { ...s.ladder, phase: 'preview' } }, step.fromVerse);
      return ok(r.state, [{ type: 'CLEAR_RECITE_TIMER' }, ...r.commands]);
    }

    case 'LADDER_GOTO_STEP':
      return s.ladder ? ladderStartStep(s, e.index) : ok(s);

    case 'LADDER_RESTART':
      return s.ladder ? ladderStartStep(s, 0) : ok(s);

    case 'LADDER_EXIT': {
      if (!s.ladder) return ok(s);
      const { fromVerse, toVerse } = s.config;
      const verse = clamp(s.verse, fromVerse, toVerse);
      const exited: EngineState = { ...s, ladder: null, activeFrom: fromVerse, activeTo: toVerse, playCount: 1 };
      const r = go(exited, verse);
      return ok(r.state, [{ type: 'CLEAR_RECITE_TIMER' }, { type: 'LADDER_EXITED' }, ...r.commands]);
    }

    default:
      return ok(s);
  }
}

// ------------------------------------------------------------------------------------------
// Store wrapper (framework-agnostic; React subscribes through useSyncExternalStore)
// ------------------------------------------------------------------------------------------

export type CommandRunner = (commands: Command[], state: EngineState) => void;

export class PlaybackEngine {
  private state: EngineState = initialState();
  private listeners = new Set<() => void>();
  private runner: CommandRunner | null = null;

  getState = (): EngineState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setRunner(runner: CommandRunner | null): void {
    this.runner = runner;
  }

  dispatch = (event: EngineEvent): Command[] => {
    const { state, commands } = reduce(this.state, event);
    if (state !== this.state) {
      this.state = state;
      this.listeners.forEach(l => l());
    }
    if (commands.length > 0 && this.runner) this.runner(commands, state);
    return commands;
  };
}
