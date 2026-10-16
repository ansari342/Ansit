/**
 * usePlaybackEngine — the host adapter between the headless PlaybackEngine and the device:
 * runs engine Commands against expo-av, timers, haptics and storage, and turns player status
 * updates into clean engine Events (stale pre-seek ticks are filtered here, not in the UI).
 */
import { useEffect, useMemo, useRef, useSyncExternalStore, useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import { Reciter, Surah } from '../types';
import {
  Command,
  EngineEvent,
  EngineState,
  PlaybackEngine,
} from '../core/playbackEngine';
import { Timeline, segmentFor } from '../core/timeline';
import {
  loadAndPlayAyah,
  pauseAudio,
  resumeAudio,
  seekAudio,
  isAudioLoaded,
  preloadUpcomingVerse,
} from '../services/audioService';
import { saveLadderProgress } from '../services/hifzLadderService';

export interface PlaybackHost {
  surah: Surah;
  reciter: Reciter;
  playbackSpeed: number;
  /** Called when the engine asks for the next reciter (Multiple mode). Host swaps reciter/timeline. */
  onNextReciter?: (startVerse: number) => void;
  /** Called when the recite timer fires. */
  onReciteTimerFired?: () => void;
  onReciteTimerArmed?: (ms: number) => void;
  onReciteTimerCleared?: () => void;
  onLadderExited?: () => void;
  /** Raw track duration discovered from the player (single-file reciters). */
  onTrackDuration?: (durationMs: number) => void;
  ladderPersistKey?: { surahNumber: number; fromVerse: number; toVerse: number; reciterId: string } | null;
}

export interface PlaybackController {
  state: EngineState;
  dispatch: (event: EngineEvent) => void;
  engine: PlaybackEngine;
}

type CommandRunnerFn = (commands: Command[], state: EngineState) => void;

const SEEK_SETTLE_MS = 650;
const SEEK_TOLERANCE_MS = 450;

export function usePlaybackEngine(host: PlaybackHost): PlaybackController {
  const engine = useMemo(() => new PlaybackEngine(), []);
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);

  const hostRef = useRef(host);
  useEffect(() => {
    hostRef.current = host;
  });

  const generationRef = useRef(0); // cancels in-flight play/resume sequences
  const loadGenRef = useRef(0); // identifies which loaded sound a status callback belongs to
  const pendingSeekRef = useRef<{ absMs: number; at: number } | null>(null);
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reciteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDelay = () => {
    if (delayTimerRef.current) clearTimeout(delayTimerRef.current);
    delayTimerRef.current = null;
  };
  const clearRecite = () => {
    if (reciteTimerRef.current) clearTimeout(reciteTimerRef.current);
    reciteTimerRef.current = null;
  };

  /** Converts expo-av status into engine events, dropping stale pre-seek ticks. */
  const handleStatus = useCallback(
    (
      status: { isPlaying: boolean; positionMillis: number; durationMillis: number; didJustFinish: boolean; isBuffering: boolean },
      timeline: Timeline | null,
      verse: number,
      generation: number
    ) => {
      if (generation !== loadGenRef.current) return;
      const isSingleFile = timeline?.kind === 'single-file';
      if (isSingleFile && status.durationMillis > 1000) hostRef.current.onTrackDuration?.(status.durationMillis);

      const pending = pendingSeekRef.current;
      if (pending) {
        if (Date.now() - pending.at < SEEK_SETTLE_MS && Math.abs(status.positionMillis - pending.absMs) > SEEK_TOLERANCE_MS) {
          return; // stale tick from before the seek landed
        }
        pendingSeekRef.current = null;
      }

      if (status.didJustFinish && !isSingleFile) {
        engine.dispatch({ type: 'ENDED' });
        return;
      }
      engine.dispatch({
        type: 'TICK',
        positionMs: status.positionMillis,
        durationMs: isSingleFile ? undefined : status.durationMillis,
        isPlaying: status.isPlaying,
      });
    },
    [engine]
  );

  const playVerse = useCallback(
    async (verse: number, offsetMs: number, s: EngineState) => {
      const generation = ++generationRef.current;
      const { surah, reciter, playbackSpeed } = hostRef.current;
      const timeline = s.timeline;
      const isSingleFile = timeline?.kind === 'single-file';
      const seg = segmentFor(timeline, verse);
      const absMs = isSingleFile ? (seg?.startMs ?? 0) + offsetMs : offsetMs;
      pendingSeekRef.current = { absMs, at: Date.now() };

      if (isSingleFile && isAudioLoaded()) {
        await seekAudio(absMs);
        await resumeAudio();
      } else {
        const loadGen = ++loadGenRef.current;
        await loadAndPlayAyah(
          surah.number,
          isSingleFile ? 1 : verse,
          reciter,
          playbackSpeed,
          status => handleStatus(status, engine.getState().timeline, verse, loadGen),
          absMs
        );
      }
      if (generation !== generationRef.current) return;
      engine.dispatch({ type: 'PLAY_STARTED', verse });

      // Warm the next verses for per-verse reciters
      if (!isSingleFile) {
        const st = engine.getState();
        if (verse + 1 <= st.activeTo) preloadUpcomingVerse(surah.number, verse + 1, reciter, playbackSpeed);
        if (verse - 1 >= st.activeFrom) preloadUpcomingVerse(surah.number, verse - 1, reciter, playbackSpeed);
      }
    },
    [engine, handleStatus]
  );

  const runRef = useRef<CommandRunnerFn | null>(null);
  const run = useCallback(
    (commands: Command[], s: EngineState) => {
      for (const c of commands) {
        switch (c.type) {
          case 'PLAY_VERSE':
            clearDelay();
            playVerse(c.verse, c.offsetMs, s);
            break;
          case 'RESUME':
            clearDelay();
            resumeAudio().then(resumed => {
              if (!resumed) playVerse(s.verse, s.positionMs, s);
            });
            break;
          case 'PAUSE':
            clearDelay();
            generationRef.current++;
            pendingSeekRef.current = null;
            pauseAudio();
            break;
          case 'AFTER_DELAY': {
            clearDelay();
            const gen = generationRef.current;
            delayTimerRef.current = setTimeout(() => {
              if (gen !== generationRef.current) return;
              runRef.current?.(c.commands, engine.getState());
            }, c.ms);
            break;
          }
          case 'NEXT_RECITER':
            hostRef.current.onNextReciter?.(c.startVerse);
            break;
          case 'HAPTIC':
            if (c.kind === 'selection') Haptics.selectionAsync().catch(() => {});
            else if (c.kind === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            else if (c.kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            break;
          case 'START_RECITE_TIMER':
            clearRecite();
            hostRef.current.onReciteTimerArmed?.(c.ms);
            reciteTimerRef.current = setTimeout(() => {
              reciteTimerRef.current = null;
              hostRef.current.onReciteTimerFired?.();
              engine.dispatch({ type: 'LADDER_COMPLETE_REP' });
            }, c.ms);
            break;
          case 'CLEAR_RECITE_TIMER':
            clearRecite();
            hostRef.current.onReciteTimerCleared?.();
            break;
          case 'PERSIST_LADDER': {
            const key = hostRef.current.ladderPersistKey;
            if (key && s.ladder) {
              saveLadderProgress({
                ...key,
                config: s.ladder.config,
                stepIndex: s.ladder.stepIndex,
                repsDone: s.ladder.repsDone,
                completed: c.completed,
              });
            }
            break;
          }
          case 'LADDER_EXITED':
            hostRef.current.onLadderExited?.();
            break;
        }
      }
    },
    [engine, playVerse]
  );

  useEffect(() => {
    runRef.current = run;
    engine.setRunner(run);
    return () => {
      runRef.current = null;
      engine.setRunner(null);
    };
  }, [engine, run]);

  useEffect(
    () => () => {
      generationRef.current++;
      clearDelay();
      clearRecite();
    },
    []
  );

  return { state, dispatch: engine.dispatch, engine };
}
