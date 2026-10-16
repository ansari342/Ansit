import { PlaybackEngine, Command, EngineConfig, DEFAULT_CONFIG } from '../src/core/playbackEngine';
import { makeTimeline, makePerVerseTimeline } from '../src/core/timeline';
import { LadderConfig } from '../src/core/ladderPlan';

const fatiha = makeTimeline('mishary', 1, 'single-file', 'bundled', {
  1: { startMs: 0, endMs: 6000 },
  2: { startMs: 6000, endMs: 12000 },
  3: { startMs: 12000, endMs: 18000 },
});

/** Minimal fake host: records commands and confirms PLAY_VERSE immediately. */
function harness() {
  const engine = new PlaybackEngine();
  const log: Command[] = [];
  engine.setRunner(cmds => {
    for (const c of cmds) {
      log.push(c);
      if (c.type === 'PLAY_VERSE') engine.dispatch({ type: 'PLAY_STARTED', verse: c.verse });
      if (c.type === 'AFTER_DELAY') {
        for (const inner of c.commands) {
          log.push(inner);
          if (inner.type === 'PLAY_VERSE') engine.dispatch({ type: 'PLAY_STARTED', verse: inner.verse });
        }
      }
    }
  });
  const plays = () => log.filter(c => c.type === 'PLAY_VERSE').map(c => (c as { verse: number }).verse);
  const tick = (abs: number) => engine.dispatch({ type: 'TICK', positionMs: abs, isPlaying: true });
  return { engine, log, plays, tick };
}

const cfg = (over: Partial<EngineConfig> = {}): EngineConfig => ({ ...DEFAULT_CONFIG, fromVerse: 1, toVerse: 3, ...over });

describe('PlaybackEngine — single-file reciter', () => {
  it('starts at the first verse and tracks position within the verse', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg(), timeline: fatiha });
    expect(h.plays()).toEqual([1]);
    h.tick(2500);
    const s = h.engine.getState();
    expect(s.verse).toBe(1);
    expect(s.positionMs).toBe(2500);
    expect(s.durationMs).toBe(6000);
  });

  it('never reports the old verse at 100% when crossing into the next verse (playhead-jump bug)', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg(), timeline: fatiha });
    h.tick(5900);
    h.tick(6010); // crossed into verse 2
    const s = h.engine.getState();
    expect(s.verse).toBe(2);
    expect(s.positionMs).toBeLessThan(100);
  });

  it('ignores ticks while a transition is in flight', () => {
    const h = harness();
    const engine = new PlaybackEngine(); // no runner → PLAY_STARTED never arrives
    engine.dispatch({ type: 'LOAD', config: cfg(), timeline: fatiha });
    expect(engine.getState().transitioning).toBe(true);
    engine.dispatch({ type: 'TICK', positionMs: 17950, isPlaying: true });
    expect(engine.getState().verse).toBe(1);
    expect(h.plays()).toEqual([]);
  });

  it('loops the range when the last verse ends in range mode', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg(), timeline: fatiha });
    h.tick(17950);
    expect(h.plays()).toEqual([1, 1]);
    expect(h.engine.getState().verse).toBe(1);
  });

  it('pauses at the end of the range in off mode', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg({ mode: 'off' }), timeline: fatiha });
    h.tick(17950);
    expect(h.engine.getState().isPlaying).toBe(false);
    expect(h.log.some(c => c.type === 'PAUSE')).toBe(true);
  });

  it('repeats each verse N times before advancing', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg({ verseRepeatCount: 2 }), timeline: fatiha });
    h.tick(5950); // end of verse 1, repeat 1 → replay 1
    expect(h.plays()).toEqual([1, 1]);
    expect(h.engine.getState().playCount).toBe(2);
    h.tick(5950); // repeat 2 → advance to 2
    expect(h.plays()).toEqual([1, 1, 2]);
    expect(h.engine.getState().playCount).toBe(1);
  });

  it('single mode replays the same verse forever', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg({ mode: 'single' }), timeline: fatiha });
    h.engine.dispatch({ type: 'SEEK_VERSE', verse: 2, fraction: 0 });
    h.tick(11950);
    expect(h.plays()).toEqual([1, 2, 2]);
  });

  it('applies a timeline upgrade only at the next boundary while playing', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg(), timeline: fatiha });
    h.tick(1000);
    const exact = makeTimeline('mishary', 1, 'single-file', 'exact', {
      1: { startMs: 0, endMs: 6500 },
      2: { startMs: 6500, endMs: 12000 },
      3: { startMs: 12000, endMs: 18000 },
    });
    h.engine.dispatch({ type: 'TIMELINE', timeline: exact });
    expect(h.engine.getState().timeline?.source).toBe('bundled');
    h.tick(17950); // range ends → boundary → upgrade applied
    expect(h.engine.getState().timeline?.source).toBe('exact');
    expect(h.engine.getState().durationMs).toBe(6500);
  });

  it('next/prev clamp to the range and reset repeat counts', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg({ verseRepeatCount: 3 }), timeline: fatiha });
    h.engine.dispatch({ type: 'PREV' });
    expect(h.engine.getState().verse).toBe(1);
    h.engine.dispatch({ type: 'NEXT' });
    h.engine.dispatch({ type: 'NEXT' });
    h.engine.dispatch({ type: 'NEXT' });
    expect(h.engine.getState().verse).toBe(3);
    expect(h.engine.getState().playCount).toBe(1);
  });

  it('SET_VERSE moves silently and pauses (Test mode navigation)', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg(), timeline: fatiha });
    h.engine.dispatch({ type: 'SET_VERSE', verse: 3 });
    const s = h.engine.getState();
    expect(s.verse).toBe(3);
    expect(s.isPlaying).toBe(false);
    expect(s.positionMs).toBe(0);
    expect(h.plays()).toEqual([1]);
    expect(h.log[h.log.length - 1].type).toBe('PAUSE');
  });

  it('inserts the configured delay between verses', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg({ delayBetweenVersesMs: 2000 }), timeline: fatiha });
    h.tick(17950);
    const delay = h.log.find(c => c.type === 'AFTER_DELAY') as { ms: number } | undefined;
    expect(delay?.ms).toBe(2000);
  });

  it('cycles reciters at the end of the range in multiple mode', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg({ cycleReciters: true }), timeline: fatiha });
    h.tick(17950);
    expect(h.log.some(c => c.type === 'NEXT_RECITER')).toBe(true);
    h.engine.dispatch({ type: 'RECITER_CHANGED', timeline: fatiha, startVerse: 1 });
    expect(h.plays()).toEqual([1, 1]);
  });

  it('auto-echo plays each verse twice', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg({ echo: true, mode: 'single' }), timeline: fatiha });
    h.tick(5950);
    expect(h.engine.getState().echoPass).toBe(2);
    h.tick(5950);
    expect(h.engine.getState().echoPass).toBe(1);
    expect(h.plays()).toEqual([1, 1, 1]);
  });
});

describe('PlaybackEngine — per-verse reciter', () => {
  it('advances on ENDED and updates duration from ticks', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg(), timeline: makePerVerseTimeline('ghamdi', 1, 3) });
    h.engine.dispatch({ type: 'TICK', positionMs: 1000, durationMs: 4200, isPlaying: true });
    expect(h.engine.getState().durationMs).toBe(4200);
    h.engine.dispatch({ type: 'ENDED' });
    expect(h.plays()).toEqual([1, 2]);
    h.engine.dispatch({ type: 'ENDED' });
    h.engine.dispatch({ type: 'ENDED' });
    expect(h.plays()).toEqual([1, 2, 3, 1]);
  });
});

describe('PlaybackEngine — Hifz Ladder', () => {
  const ladder: LadderConfig = { listenNew: 2, reciteNew: 2, listenCombined: 1, reciteCombined: 1, combineStyle: 'cumulative', reciteTiming: 'auto' };

  it('runs listen → recite → combined steps and completes', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg({ toVerse: 2 }), timeline: fatiha, ladder: { config: ladder } });
    // Plan: L1x2 R1x2 L2x2 R2x2 L1-2x1 R1-2x1
    expect(h.engine.getState().ladder?.plan.length).toBe(6);
    expect(h.engine.getState().activeTo).toBe(1);

    h.tick(5950); // listen 1 of 2
    expect(h.engine.getState().ladder?.repsDone).toBe(1);
    h.tick(5950); // listen 2 of 2 → recite step
    const s1 = h.engine.getState();
    expect(s1.ladder?.stepIndex).toBe(1);
    expect(s1.ladder?.phase).toBe('recite');
    expect(s1.isPlaying).toBe(false);
    expect(h.log.some(c => c.type === 'START_RECITE_TIMER')).toBe(true);

    // ticks are ignored while reciting
    h.tick(5950);
    expect(h.engine.getState().ladder?.stepIndex).toBe(1);

    // hear it again → preview → back to recite with a fresh timer
    h.engine.dispatch({ type: 'LADDER_HEAR_AGAIN' });
    expect(h.engine.getState().ladder?.phase).toBe('preview');
    h.tick(5950);
    expect(h.engine.getState().ladder?.phase).toBe('recite');

    h.engine.dispatch({ type: 'LADDER_COMPLETE_REP' });
    h.engine.dispatch({ type: 'LADDER_COMPLETE_REP' }); // → step 2: listen v2
    const s2 = h.engine.getState();
    expect(s2.ladder?.stepIndex).toBe(2);
    expect(s2.verse).toBe(2);
    expect(s2.activeFrom).toBe(2);

    h.tick(11950);
    h.tick(11950); // → recite v2
    h.engine.dispatch({ type: 'LADDER_COMPLETE_REP' });
    h.engine.dispatch({ type: 'LADDER_COMPLETE_REP' }); // → combined listen 1-2
    expect(h.engine.getState().activeFrom).toBe(1);
    expect(h.engine.getState().activeTo).toBe(2);

    h.tick(11950); // range 1-2 done once → combined recite
    expect(h.engine.getState().ladder?.phase).toBe('recite');
    h.engine.dispatch({ type: 'LADDER_COMPLETE_REP' }); // → complete
    expect(h.engine.getState().ladder?.phase).toBe('complete');
    expect(h.log.filter(c => c.type === 'PERSIST_LADDER' && (c as { completed: boolean }).completed).length).toBe(1);
  });

  it('resumes at a saved step', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg({ toVerse: 2 }), timeline: fatiha, ladder: { config: ladder, stepIndex: 2, repsDone: 1 } });
    expect(h.engine.getState().ladder?.stepIndex).toBe(2);
    expect(h.engine.getState().ladder?.repsDone).toBe(1);
    expect(h.plays()).toEqual([2]);
  });

  it('exit continues normal playback from the current verse', () => {
    const h = harness();
    h.engine.dispatch({ type: 'LOAD', config: cfg({ toVerse: 3 }), timeline: fatiha, ladder: { config: ladder, stepIndex: 2 } });
    h.engine.dispatch({ type: 'LADDER_EXIT' });
    const s = h.engine.getState();
    expect(s.ladder).toBeNull();
    expect(s.activeTo).toBe(3);
    expect(s.verse).toBe(2);
  });
});
