import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, StatusBar } from 'react-native';
import { Ionicons, Feather, MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Surah, Verse, Reciter, LoopSettings } from '../types';
import { getVersesForSurah, parseArabicWords } from '../services/quranService';
import { stopAndUnloadAudio, setAudioRate } from '../services/audioService';
import { prefetchVerseRange } from '../services/cacheService';
import { AyahTiming } from '../data/reciterTimings';
import { BASE_RECITERS } from '../data/reciters';
import { getAyahWordTimings } from '../services/timingService';
import { resolveInstantTimeline, resolveExactTimeline, effectiveReciter } from '../services/timelineService';
import { rescaleToDuration, segmentFor } from '../core/timeline';
import { usePlaybackEngine } from '../hooks/usePlaybackEngine';
import { LadderConfig, LadderProgress, describeStep } from '../services/hifzLadderService';
import { stopTakePlayback } from '../services/takeService';
import { updateCarPlayState, clearNowPlayingState, registerNowPlayingHandlers } from '../services/carPlayService';
import { recordListenSession } from '../services/analyticsService';
import { LoopSettingsModal } from './LoopSettingsModal';
import { SoundwaveVisualizer } from './SoundwaveVisualizer';
import { BouncyTouchable } from './BouncyTouchable';
import { SegmentedPlaybackBar } from './SegmentedPlaybackBar';
import { VocalPitchMonitor, PitchPracticeMode } from './VocalPitchMonitor';
import { HifzLadderHud } from './HifzLadderHud';
import { HifzLadderSetupModal } from './HifzLadderSetupModal';
import { VerseHero } from './VerseHero';
import { ReciteCorrect, ReciteControls, ReciteStage } from './ReciteCorrect';
import { Segmented } from './ui/Segmented';
import { colors, space, type, pill, shadow } from '../theme';

export interface LadderSessionConfig {
  config: LadderConfig;
  resumeStepIndex?: number;
  resumeRepsDone?: number;
}

interface PlaybackStateReport {
  isPlaying: boolean;
  currentVerseNum: number;
  togglePlayPause: () => void;
  currentReciterName?: string;
}

interface NowPlayingScreenProps {
  surah: Surah;
  fromVerse: number;
  toVerse: number;
  reciter: Reciter;
  sessionId?: number;
  initialLoopSettings?: LoopSettings;
  ladder?: LadderSessionConfig | null;
  onExitLadder?: () => void;
  onStartLadder?: (config: LadderConfig, resume: LadderProgress | null) => void;
  onMinimize: () => void;
  onPlaybackStateChange?: (state: PlaybackStateReport) => void;
}

type Tab = 'listen' | 'test';
type TestMode = 'recite' | 'pitch';

const DEFAULT_LOOP: LoopSettings = { mode: 'range', verseRepeatCount: 1, playbackSpeed: 1.0, delayBetweenVersesSeconds: 0 };

export const NowPlayingScreen: React.FC<NowPlayingScreenProps> = ({
  surah,
  fromVerse,
  toVerse,
  reciter,
  sessionId,
  initialLoopSettings,
  ladder = null,
  onExitLadder,
  onStartLadder,
  onMinimize,
  onPlaybackStateChange,
}) => {
  // ---------------------------------------------------------------- local UI state
  const [verses, setVerses] = useState<Verse[]>([]);
  const [verseTimings, setVerseTimings] = useState<Record<number, AyahTiming>>({});
  const [loopSettings, setLoopSettings] = useState<LoopSettings>(initialLoopSettings || DEFAULT_LOOP);
  const [trackDurationMs, setTrackDurationMs] = useState(1);
  const [reciterIndex, setReciterIndex] = useState(0);
  const [tab, setTab] = useState<Tab>('listen');
  const [testMode, setTestMode] = useState<TestMode>('recite');
  const [pitchMode, setPitchMode] = useState<PitchPracticeMode>('listen');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [ladderSetupVisible, setLadderSetupVisible] = useState(false);
  const [reciteRemainingSec, setReciteRemainingSec] = useState<number | null>(null);
  const [isPeeking, setIsPeeking] = useState(false);
  const [reciteStage, setReciteStage] = useState<ReciteStage>('idle');
  const reciteControlsRef = useRef<ReciteControls | null>(null);

  const isMultipleMode = reciter.id === 'multiple';
  const currentReciter = isMultipleMode ? BASE_RECITERS[reciterIndex] : reciter;
  const isSingleFile = !!effectiveReciter(currentReciter).isSurahBased;

  // ---------------------------------------------------------------- engine
  const reciteTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopReciteCountdown = useCallback(() => {
    if (reciteTickRef.current) clearInterval(reciteTickRef.current);
    reciteTickRef.current = null;
    setReciteRemainingSec(null);
  }, []);

  const { state, dispatch, engine } = usePlaybackEngine({
    surah,
    reciter: currentReciter,
    playbackSpeed: loopSettings.playbackSpeed,
    ladderPersistKey: ladder ? { surahNumber: surah.number, fromVerse, toVerse, reciterId: reciter.id } : null,
    onTrackDuration: ms => setTrackDurationMs(prev => (Math.abs(prev - ms) > 100 ? ms : prev)),
    onReciteTimerArmed: ms => {
      stopReciteCountdown();
      const deadline = Date.now() + ms;
      setReciteRemainingSec(Math.ceil(ms / 1000));
      reciteTickRef.current = setInterval(() => setReciteRemainingSec(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    },
    onReciteTimerCleared: stopReciteCountdown,
    onReciteTimerFired: stopReciteCountdown,
    onLadderExited: () => onExitLadder?.(),
    onNextReciter: startVerse => {
      const nextIndex = (reciterIndex + 1) % BASE_RECITERS.length;
      setReciterIndex(nextIndex);
      const next = BASE_RECITERS[nextIndex];
      const { timeline, timings } = resolveInstantTimeline(next, surah.number, verses, trackDurationMs);
      setVerseTimings(timings);
      dispatch({ type: 'RECITER_CHANGED', timeline, startVerse });
      resolveExactTimeline(next, surah.number, verses).then(exact => {
        if (exact) {
          setVerseTimings(exact.timings);
          dispatch({ type: 'TIMELINE', timeline: exact.timeline });
        }
      });
      prefetchVerseRange(BASE_RECITERS[(nextIndex + 1) % BASE_RECITERS.length], surah.number, fromVerse, toVerse);
    },
  });

  // ---------------------------------------------------------------- session load
  const ladderRef = useRef(ladder);
  useEffect(() => {
    ladderRef.current = ladder;
  }, [ladder]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const rec = isMultipleMode ? BASE_RECITERS[0] : reciter;
      setReciterIndex(0);
      prefetchVerseRange(rec, surah.number, fromVerse, toVerse);
      const loaded = await getVersesForSurah(surah.number);
      if (!mounted) return;
      setVerses(loaded);

      const { timeline, timings } = resolveInstantTimeline(rec, surah.number, loaded, 1);
      setVerseTimings(timings);
      const l = ladderRef.current;
      dispatch({
        type: 'LOAD',
        config: {
          fromVerse,
          toVerse,
          mode: loopSettings.mode,
          verseRepeatCount: loopSettings.verseRepeatCount,
          delayBetweenVersesMs: loopSettings.delayBetweenVersesSeconds * 1000,
          cycleReciters: isMultipleMode,
          echo: false,
        },
        timeline,
        ladder: l ? { config: l.config, stepIndex: l.resumeStepIndex, repsDone: l.resumeRepsDone } : null,
      });
      recordListenSession(surah, fromVerse, toVerse, rec).catch(() => {});

      const exact = await resolveExactTimeline(rec, surah.number, loaded);
      if (mounted && exact) {
        setVerseTimings(exact.timings);
        dispatch({ type: 'TIMELINE', timeline: exact.timeline });
      }
    })();
    return () => {
      mounted = false;
      stopTakePlayback();
      stopAndUnloadAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surah.number, reciter.id, fromVerse, toVerse, sessionId]);

  useEffect(() => {
    const t = engine.getState().timeline;
    if (t && t.source === 'estimated' && trackDurationMs > 1000) {
      const scaled = rescaleToDuration(t, trackDurationMs);
      if (scaled !== t) dispatch({ type: 'TIMELINE', timeline: scaled });
    }
  }, [trackDurationMs, engine, dispatch]);

  useEffect(() => {
    dispatch({
      type: 'SET_CONFIG',
      config: {
        mode: loopSettings.mode,
        verseRepeatCount: loopSettings.verseRepeatCount,
        delayBetweenVersesMs: loopSettings.delayBetweenVersesSeconds * 1000,
        echo: false,
      },
    });
    setAudioRate(loopSettings.playbackSpeed);
  }, [loopSettings, dispatch]);

  useEffect(() => () => clearNowPlayingState(), []);

  // ---------------------------------------------------------------- derived
  const currentVerse = useMemo(() => verses.find(v => v.numberInSurah === state.verse), [verses, state.verse]);
  const previousVerse = useMemo(
    () => (state.verse > 1 ? verses.find(v => v.numberInSurah === state.verse - 1) : undefined),
    [verses, state.verse]
  );
  const words = useMemo(() => (currentVerse ? parseArabicWords(currentVerse.arabicText) : []), [currentVerse]);
  const wordTimings = useMemo(
    () => (currentVerse ? getAyahWordTimings(verseTimings[state.verse], words, !isSingleFile, state.durationMs) : []),
    [currentVerse, verseTimings, state.verse, words, isSingleFile, state.durationMs]
  );
  const seg = segmentFor(state.timeline, state.verse);
  const absolutePosMs = isSingleFile ? (seg?.startMs ?? 0) + state.positionMs : state.positionMs;
  const activeWordIndex = useMemo(() => {
    if (wordTimings.length === 0 || (!state.isPlaying && state.positionMs === 0)) return -1;
    for (let i = 0; i < wordTimings.length; i++) {
      if (absolutePosMs >= wordTimings[i].startMs && absolutePosMs < wordTimings[i].endMs) return i;
    }
    return absolutePosMs >= wordTimings[wordTimings.length - 1].endMs ? wordTimings.length : -1;
  }, [wordTimings, absolutePosMs, state.isPlaying, state.positionMs]);

  const ladderState = state.ladder;
  const ladderActive = !!ladderState;
  const isLadderReciting = ladderState?.phase === 'recite';
  const isTest = tab === 'test';
  const showPitch = isTest && testMode === 'pitch';
  const showRecite = isTest && testMode === 'recite';
  const showBismillah = surah.number !== 1 && surah.number !== 9 && state.verse === 1;
  const compactHero = showPitch || ladderActive;

  // ---------------------------------------------------------------- tab switching
  const selectTab = useCallback(
    (next: Tab) => {
      if (next === tab) return;
      setTab(next);
      if (next === 'test') {
        dispatch({ type: 'PAUSE' });
      } else {
        stopTakePlayback();
      }
    },
    [tab, dispatch]
  );

  // Pitch Trace needs the reciter playing; Recite needs it silent
  useEffect(() => {
    if (showRecite) dispatch({ type: 'PAUSE' });
  }, [showRecite, dispatch]);

  // ---------------------------------------------------------------- Now Playing / mini-player
  useEffect(() => {
    const step = ladderState ? ladderState.plan[ladderState.stepIndex] : null;
    updateCarPlayState({
      currentSurah: surah,
      currentVerseNum: state.verse,
      fromVerse,
      toVerse,
      reciter: currentReciter,
      isPlaying: state.isPlaying,
      positionMillis: state.positionMs,
      durationMillis: state.durationMs,
      playbackRate: loopSettings.playbackSpeed,
      titleOverride:
        ladderState && step
          ? ladderState.phase === 'complete'
            ? `Ladder complete • Surah ${surah.englishName}`
            : `Step ${ladderState.stepIndex + 1}/${ladderState.plan.length} • ${ladderState.phase === 'recite' ? 'Your turn' : 'Listen'} ${describeStep(step).replace(/^(Listen|Recite) /, '')}`
          : null,
    });
  }, [surah, state.verse, state.isPlaying, state.positionMs, state.durationMs, fromVerse, toVerse, currentReciter, loopSettings.playbackSpeed, ladderState]);

  const toggle = useCallback(() => dispatch({ type: 'TOGGLE' }), [dispatch]);
  useEffect(() => {
    onPlaybackStateChange?.({ isPlaying: state.isPlaying, currentVerseNum: state.verse, togglePlayPause: toggle, currentReciterName: currentReciter.shortName });
  }, [state.isPlaying, state.verse, currentReciter.shortName, onPlaybackStateChange, toggle]);

  useEffect(
    () =>
      registerNowPlayingHandlers({
        onPlay: () => dispatch({ type: 'PLAY' }),
        onPause: () => dispatch({ type: 'PAUSE' }),
        onTogglePlayPause: () => dispatch({ type: 'TOGGLE' }),
        onNext: () => dispatch({ type: 'NEXT' }),
        onPrevious: () => dispatch({ type: 'PREV' }),
        onSeekToSeconds: sec => {
          const s = engine.getState();
          dispatch({ type: 'SEEK_VERSE', verse: s.verse, fraction: (sec * 1000) / Math.max(1, s.durationMs) });
        },
        onAudioRouteLost: () => dispatch({ type: 'PAUSE' }),
        onInterruptionBegan: () => dispatch({ type: 'PAUSE' }),
      }),
    [dispatch, engine]
  );

  // ---------------------------------------------------------------- handlers
  const handleSeekAyah = useCallback(
    (verse: number, fraction: number = 0) => {
      if (showRecite) dispatch({ type: 'SET_VERSE', verse });
      else dispatch({ type: 'SEEK_VERSE', verse, fraction });
    },
    [dispatch, showRecite]
  );
  const prev = useCallback(() => {
    if (showRecite) {
      dispatch({ type: 'SET_VERSE', verse: state.verse > state.activeFrom ? state.verse - 1 : state.activeTo });
    } else {
      dispatch({ type: 'PREV' });
    }
  }, [dispatch, showRecite, state.verse, state.activeFrom, state.activeTo]);
  const next = useCallback(() => {
    if (showRecite) {
      dispatch({ type: 'SET_VERSE', verse: state.verse < state.activeTo ? state.verse + 1 : state.activeFrom });
    } else {
      dispatch({ type: 'NEXT' });
    }
  }, [dispatch, showRecite, state.verse, state.activeFrom, state.activeTo]);
  const cycleLoopMode = useCallback(() => {
    const order: LoopSettings['mode'][] = ['range', 'single', 'off'];
    setLoopSettings(p => ({ ...p, mode: order[(order.indexOf(p.mode) + 1) % order.length] }));
  }, []);
  const toggleMemorize = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    if (ladderActive) dispatch({ type: 'LADDER_EXIT' });
    else setLadderSetupVisible(true);
  }, [ladderActive, dispatch]);

  // ---------------------------------------------------------------- center button
  const renderCenter = () => {
    if (showRecite) {
      const stage = reciteStage;
      const icon = stage === 'idle' ? 'mic' : stage === 'recording' ? 'stop' : 'play';
      const bg = stage === 'recording' ? colors.danger : colors.gold;
      return (
        <BouncyTouchable style={[styles.playPauseBtn, { backgroundColor: bg }, shadow.glow(bg)]} triggerOnPressIn onPress={() => reciteControlsRef.current?.primary()}>
          <Ionicons name={icon} size={stage === 'idle' ? 30 : 32} color={stage === 'recording' ? colors.text : colors.bg} style={icon === 'play' ? { marginLeft: 3 } : undefined} />
        </BouncyTouchable>
      );
    }
    if (isLadderReciting) {
      return (
        <BouncyTouchable style={[styles.playPauseBtn, { backgroundColor: colors.gold }, shadow.glow(colors.gold)]} triggerOnPressIn onPress={() => dispatch({ type: 'LADDER_COMPLETE_REP' })}>
          <Ionicons name="checkmark" size={34} color={colors.bg} />
        </BouncyTouchable>
      );
    }
    if (ladderState?.phase === 'complete') {
      return (
        <BouncyTouchable style={[styles.playPauseBtn, { backgroundColor: colors.mint }, shadow.glow(colors.mint)]} triggerOnPressIn onPress={() => dispatch({ type: 'LADDER_RESTART' })}>
          <Ionicons name="refresh" size={30} color={colors.bg} />
        </BouncyTouchable>
      );
    }
    return (
      <BouncyTouchable style={styles.playPauseBtn} triggerOnPressIn onPress={toggle}>
        <Ionicons name={state.isPlaying ? 'pause' : 'play'} size={32} color="#0a101d" style={!state.isPlaying ? { marginLeft: 3 } : undefined} />
      </BouncyTouchable>
    );
  };

  const memorizePill = pill(ladderActive ? 'gold' : 'neutral');

  // ---------------------------------------------------------------- render
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* Header: back · Listen | Test · settings */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={onMinimize} hitSlop={8}>
          <Ionicons name="chevron-down" size={24} color={colors.text} />
        </TouchableOpacity>
        <Segmented<Tab>
          options={[
            { key: 'listen', label: 'Listen' },
            { key: 'test', label: 'Test' },
          ]}
          value={tab}
          onChange={selectTab}
          tone={isTest ? 'gold' : 'sapphire'}
        />
        <TouchableOpacity style={styles.iconBtn} onPress={() => setSettingsVisible(true)} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Title + one sub-control */}
      <View style={[styles.titleBlock, compactHero && styles.titleBlockCompact]}>
        <Text style={[styles.title, compactHero && styles.titleCompact]}>Surah {surah.englishName}</Text>
        <View style={styles.subtitleRow}>
          {isMultipleMode && (
            <View style={pill('gold').container}>
              <Ionicons name="repeat" size={11} color={colors.gold} />
              <Text style={pill('gold').text}>Multiple</Text>
            </View>
          )}
          <Text style={styles.subtitle}>{isTest ? `Verse ${state.verse} · ` : ''}{currentReciter.name}</Text>
          {!isTest && <SoundwaveVisualizer isPlaying={state.isPlaying} color={colors.sapphire} barCount={4} maxHeight={14} />}
        </View>

        <View style={styles.subControl}>
          {isTest ? (
            <Segmented<TestMode>
              options={[
                { key: 'recite', label: 'Recite', icon: 'mic-outline' },
                { key: 'pitch', label: 'Pitch', icon: 'pulse-outline' },
              ]}
              value={testMode}
              onChange={m => {
                stopTakePlayback();
                setTestMode(m);
              }}
              tone="gold"
              size="sm"
            />
          ) : (
            <TouchableOpacity style={memorizePill.container} onPress={toggleMemorize}>
              <Ionicons name={ladderActive ? 'layers' : 'layers-outline'} size={12} color={memorizePill.color} />
              <Text style={memorizePill.text}>
                {ladderActive && ladderState ? `Memorize · step ${ladderState.stepIndex + 1}/${ladderState.plan.length}` : 'Memorize'}
              </Text>
              {ladderActive && <Ionicons name="close" size={12} color={memorizePill.color} />}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Ladder HUD (Listen only) */}
      {!isTest && ladderState && (
        <HifzLadderHud
          plan={ladderState.plan}
          stepIndex={ladderState.stepIndex}
          repsDone={ladderState.repsDone}
          phase={ladderState.phase}
          reciteRemainingSec={reciteRemainingSec}
          reciteTiming={ladderState.config.reciteTiming}
          onCompleteRep={() => dispatch({ type: 'LADDER_COMPLETE_REP' })}
          onHearAgain={() => dispatch({ type: 'LADDER_HEAR_AGAIN' })}
          onRestartLadder={() => dispatch({ type: 'LADDER_RESTART' })}
          onExit={() => dispatch({ type: 'LADDER_EXIT' })}
        />
      )}

      {/* Middle */}
      <View style={styles.middle}>
        {showRecite ? (
          <ReciteCorrect
            key={`${surah.number}_${state.verse}`}
            surahNumber={surah.number}
            verse={state.verse}
            verseData={currentVerse}
            previousVerseData={previousVerse}
            words={words}
            wordTimings={wordTimings}
            onStageChange={setReciteStage}
            controlRef={reciteControlsRef}
          />
        ) : (
          <>
            <VerseHero
              verse={currentVerse}
              verseNumber={state.verse}
              words={words}
              activeWordIndex={activeWordIndex}
              showBismillah={showBismillah}
              compact={compactHero}
              hidden={!isTest && isLadderReciting && !isPeeking}
              onPeekStart={() => setIsPeeking(true)}
              onPeekEnd={() => setIsPeeking(false)}
              onDoubleTap={() => dispatch({ type: 'LADDER_HEAR_AGAIN' })}
            />
            {showPitch && (
              <View style={styles.pitchWrap}>
                <VocalPitchMonitor
                  surahNumber={surah.number}
                  ayahNumber={state.verse}
                  words={words}
                  wordTimings={wordTimings}
                  reciter={currentReciter}
                  positionMillis={state.positionMs}
                  durationMillis={state.durationMs}
                  ayahStartMs={seg?.startMs ?? 0}
                  ayahEndMs={seg?.endMs ?? 0}
                  totalTrackDurationMs={trackDurationMs}
                  isPlaying={state.isPlaying}
                  echoPass={1}
                  mode={pitchMode}
                  onChangeMode={setPitchMode}
                  onSeekFraction={fraction => handleSeekAyah(state.verse, fraction)}
                />
              </View>
            )}
          </>
        )}
      </View>

      {/* 4. PERMANENTLY STATIC BOTTOM SECTION WITH SCRUBBER & SYMMETRIC 5-BUTTON CONTROLS */}
      <View style={styles.bottomSection}>
        <SegmentedPlaybackBar
          fromVerse={state.activeFrom}
          toVerse={state.activeTo}
          currentVerseNum={state.verse}
          positionMillis={state.positionMs}
          durationMillis={state.durationMs}
          onSeekAyah={handleSeekAyah}
        />

        {/* Simplified Verse Indicator: e.g. Verse 5/7 */}
        <View style={styles.verseIndicatorBanner}>
          <Text style={styles.verseIndicatorText}>
            Verse {state.verse}/{state.activeTo}
          </Text>

          {!ladderActive && loopSettings.verseRepeatCount > 1 && (
            <View style={styles.repeatBadge}>
              <Text style={styles.repeatBadgeText}>
                {state.playCount}/{loopSettings.verseRepeatCount}
              </Text>
            </View>
          )}
        </View>

        {/* Symmetric 5-Button Controls Row (Play/Pause dead-center) */}
        <View style={styles.controlsRow}>
          <BouncyTouchable
            style={styles.controlIconBtn}
            onPress={() => setSettingsVisible(true)}
          >
            <Feather name="sliders" size={20} color="#8a95aa" />
          </BouncyTouchable>

          <BouncyTouchable
            style={styles.controlIconBtn}
            triggerOnPressIn={true}
            onPress={prev}
            accessibilityLabel="Previous verse"
          >
            <MaterialIcons name="skip-previous" size={30} color="#ffffff" />
          </BouncyTouchable>

          {renderCenter()}

          <BouncyTouchable
            style={styles.controlIconBtn}
            triggerOnPressIn={true}
            onPress={next}
            accessibilityLabel="Next verse"
          >
            <MaterialIcons name="skip-next" size={30} color="#ffffff" />
          </BouncyTouchable>

          {showRecite ? (
            <BouncyTouchable
              style={[
                styles.controlIconBtn,
                reciteStage === 'review' && styles.loopActiveBtn,
              ]}
              disabled={reciteStage !== 'review'}
              onPress={() => reciteControlsRef.current?.playAB()}
            >
              <Ionicons
                name="repeat"
                size={22}
                color={reciteStage === 'review' ? colors.gold : colors.textFaint}
              />
              <Text
                style={[
                  styles.cornerLabel,
                  { color: reciteStage === 'review' ? colors.gold : colors.textFaint },
                ]}
              >
                A·B
              </Text>
            </BouncyTouchable>
          ) : (
            <BouncyTouchable
              style={[
                styles.controlIconBtn,
                !ladderActive && loopSettings.mode !== 'off' && styles.loopActiveBtn,
              ]}
              triggerOnPressIn={true}
              disabled={ladderActive}
              onPress={cycleLoopMode}
            >
              <Ionicons
                name={loopSettings.mode === 'single' ? 'repeat-outline' : 'repeat'}
                size={22}
                color={
                  ladderActive
                    ? colors.textFaint
                    : loopSettings.mode !== 'off'
                    ? '#9bbfff'
                    : '#8a95aa'
                }
              />
              {!ladderActive && loopSettings.mode !== 'off' && (
                <View style={styles.loopDot} />
              )}
            </BouncyTouchable>
          )}
        </View>
      </View>

      <HifzLadderSetupModal
        visible={ladderSetupVisible}
        surah={surah}
        fromVerse={fromVerse}
        toVerse={toVerse}
        reciter={currentReciter}
        onClose={() => setLadderSetupVisible(false)}
        onStart={(config, resume) => {
          setLadderSetupVisible(false);
          setTab('listen');
          onStartLadder?.(config, resume);
        }}
      />

      <LoopSettingsModal visible={settingsVisible} settings={loopSettings} onUpdateSettings={setLoopSettings} onClose={() => setSettingsVisible(false)} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080b11' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#151d2d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  titleBlockCompact: { paddingTop: 2, paddingBottom: 4 },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  titleCompact: { fontSize: 19, marginBottom: 2 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subtitle: { fontSize: 13, color: '#8a95aa' },
  subControl: { marginTop: space.sm, alignItems: 'center' },
  middle: { flex: 1, minHeight: 0, justifyContent: 'center' },
  pitchWrap: { paddingHorizontal: 20, paddingBottom: 4 },
  bottomSection: {
    paddingHorizontal: 24,
    paddingBottom: 28,
    paddingTop: 4,
    backgroundColor: '#080b11',
  },
  verseIndicatorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#0f1726',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 2,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1e2d44',
  },
  verseIndicatorText: {
    color: '#9bbfff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  repeatBadge: {
    backgroundColor: '#1d2d47',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: '#2e456b',
  },
  repeatBadgeText: {
    color: '#e5b869',
    fontSize: 11,
    fontWeight: '700',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 10,
  },
  controlIconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  loopActiveBtn: {
    backgroundColor: '#162238',
  },
  loopDot: {
    position: 'absolute',
    bottom: 5,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#9bbfff',
  },
  playPauseBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#9bbfff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#9bbfff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  cornerLabel: {
    position: 'absolute',
    bottom: 4,
    ...type.caption,
    color: colors.sapphire,
    fontSize: 9.5,
  },
});
