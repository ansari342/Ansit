import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Animated,
} from 'react-native';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Surah, Verse, Reciter, LoopSettings } from '../types';
import { getVersesForSurah, parseArabicWords } from '../services/quranService';
import {
  loadAndPlayAyah,
  preloadUpcomingVerse,
  pauseAudio,
  resumeAudio,
  seekAudio,
  stopAndUnloadAudio,
  setAudioRate,
  isAudioLoaded,
} from '../services/audioService';
import { prefetchVerseRange } from '../services/cacheService';
import { LoopSettingsModal } from './LoopSettingsModal';
import {
  AyahTiming,
  WordTiming,
  RECITER_TIMINGS,
  getSurahVerseTimings,
} from '../data/reciterTimings';
import { BASE_RECITERS } from '../data/reciters';
import {
  getInstantTimings,
  fetchSurahVerseTimings,
  getAyahWordTimings,
} from '../services/timingService';
import { SoundwaveVisualizer } from './SoundwaveVisualizer';
import { BouncyTouchable } from './BouncyTouchable';
import { SegmentedPlaybackBar } from './SegmentedPlaybackBar';
import { VocalPitchMonitor, PitchPracticeMode } from './VocalPitchMonitor';
import {
  updateCarPlayState,
  clearNowPlayingState,
  registerNowPlayingHandlers,
} from '../services/carPlayService';
import { recordListenSession } from '../services/analyticsService';

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
  onMinimize: () => void;
  onPlaybackStateChange?: (state: PlaybackStateReport) => void;
}

const toArabicIndic = (num: number): string => {
  const digits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return num
    .toString()
    .split('')
    .map(d => digits[parseInt(d, 10)] || d)
    .join('');
};

interface QuranCardViewProps {
  currentVerse?: Verse;
  currentVerseNum: number;
  showBismillahHeader: boolean;
  cardOpacity: Animated.Value;
  cardScale: Animated.Value;
  cardSlideX: Animated.Value;
  auraGlow: Animated.Value;
  currentWordIndex: number;
  words: string[];
  compact?: boolean;
}

const QuranCardView = React.memo<QuranCardViewProps>(({
  currentVerse,
  currentVerseNum,
  showBismillahHeader,
  cardOpacity,
  cardScale,
  cardSlideX,
  auraGlow,
  currentWordIndex,
  words,
  compact = false,
}) => {
  const cardScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    cardScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [currentVerseNum]);

  return (
    <View style={[styles.cardWrapper, compact && styles.cardWrapperCompact]}>
      {/* Meditative Ambient Radial Aura */}
      <Animated.View
        style={[
          styles.ambientAura,
          {
            opacity: auraGlow,
          },
        ]}
      />

      <Animated.View
        style={[
          styles.quranCard,
          {
            opacity: cardOpacity,
            transform: [{ scale: cardScale }, { translateX: cardSlideX }],
          },
        ]}
      >
        <ScrollView
          ref={cardScrollRef}
          contentContainerStyle={[
            styles.cardScrollContent,
            compact && styles.cardScrollContentCompact,
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Gilded Bismillah Banner */}
          {showBismillahHeader && !compact && (
            <View style={styles.bismillahBox}>
              <Text style={styles.bismillahText}>
                بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
              </Text>
              <View style={styles.bismillahUnderline} />
            </View>
          )}

          {/* Word-By-Word Glowing Highlighting */}
          <Text style={[styles.arabicText, compact && styles.arabicTextCompact]}>
            {words.length > 0 ? (
              <>
                {words.map((word, index) => {
                  const isSpoken = currentWordIndex >= 0 && index < currentWordIndex;
                  const isCurrent = currentWordIndex === index;
                  const isUpcoming = currentWordIndex >= 0 && index > currentWordIndex;

                  return (
                    <Text
                      key={`${index}_${word}`}
                      style={[
                        styles.wordBase,
                        compact && styles.wordBaseCompact,
                        isSpoken && styles.wordSpoken,
                        isCurrent && styles.wordCurrent,
                        isUpcoming && styles.wordUpcoming,
                      ]}
                    >
                      {word}
                      {index < words.length - 1 ? ' ' : ''}
                    </Text>
                  );
                })}
                <Text
                  style={[
                    styles.ayahEndSymbol,
                    compact && styles.ayahEndSymbolCompact,
                    currentWordIndex >= words.length && styles.ayahEndSymbolActive,
                  ]}
                >
                  {' '}
                  ﴿{toArabicIndic(currentVerseNum)}﴾
                </Text>
              </>
            ) : (
              <Text style={[styles.wordBase, compact && styles.wordBaseCompact]}>
                {currentVerse?.arabicText || 'Loading verse...'}
              </Text>
            )}
          </Text>

          <View style={[styles.cardDivider, compact && styles.cardDividerCompact]} />

          {/* English Translation */}
          <Text
            style={[styles.translationText, compact && styles.translationTextCompact]}
            numberOfLines={compact ? 2 : undefined}
          >
            "{currentVerse?.englishText || 'Loading translation...'}"
          </Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
});

export const NowPlayingScreen: React.FC<NowPlayingScreenProps> = ({
  surah,
  fromVerse,
  toVerse,
  reciter,
  sessionId,
  initialLoopSettings,
  onMinimize,
  onPlaybackStateChange,
}) => {
  const [verses, setVerses] = useState<Verse[]>([]);
  const [currentVerseNum, setCurrentVerseNum] = useState<number>(fromVerse);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [durationMillis, setDurationMillis] = useState<number>(1);
  const [currentVersePositionMillis, setCurrentVersePositionMillis] = useState<number>(0);
  const [currentVerseDurationMillis, setCurrentVerseDurationMillis] = useState<number>(1);
  const isUserScrubbingRef = useRef<boolean>(false);
  const [verseTimings, setVerseTimings] = useState<Record<number, AyahTiming>>({});

  const isMultipleMode = reciter.id === 'multiple';
  const [multipleReciterIndex, setMultipleReciterIndex] = useState<number>(0);
  const multipleReciterIndexRef = useRef<number>(0);

  // Keep ref in sync
  useEffect(() => {
    multipleReciterIndexRef.current = multipleReciterIndex;
  }, [multipleReciterIndex]);

  // Reset index when reciter prop changes
  useEffect(() => {
    multipleReciterIndexRef.current = 0;
    setMultipleReciterIndex(0);
  }, [reciter.id]);

  const currentEffectiveReciter = isMultipleMode
    ? BASE_RECITERS[multipleReciterIndex]
    : reciter;

  const isTimedReciter = !!currentEffectiveReciter.isSurahBased;

  // Delightful Animation Values
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const cardScale = useRef(new Animated.Value(1)).current;
  const cardSlideX = useRef(new Animated.Value(0)).current;
  const auraGlow = useRef(new Animated.Value(0.3)).current;

  // Meditative ambient breathing glow loop
  useEffect(() => {
    const breathingLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(auraGlow, {
          toValue: 0.65,
          duration: 3200,
          useNativeDriver: true,
        }),
        Animated.timing(auraGlow, {
          toValue: 0.25,
          duration: 3200,
          useNativeDriver: true,
        }),
      ])
    );
    breathingLoop.start();
    return () => breathingLoop.stop();
  }, [auraGlow]);

  // Spring transition animation when current ayah changes
  const animateVerseChange = useCallback(() => {
    cardOpacity.setValue(0.35);
    cardScale.setValue(0.97);
    cardSlideX.setValue(10);

    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        toValue: 1,
        speed: 24,
        bounciness: 6,
        useNativeDriver: true,
      }),
      Animated.spring(cardSlideX, {
        toValue: 0,
        speed: 24,
        bounciness: 6,
        useNativeDriver: true,
      }),
    ]).start();
  }, [cardOpacity, cardScale, cardSlideX]);

  // Loop settings & repeat counter
  const [loopSettings, setLoopSettings] = useState<LoopSettings>(
    initialLoopSettings || {
      mode: 'range',
      verseRepeatCount: 1,
      playbackSpeed: 1.0,
      delayBetweenVersesSeconds: 0,
    }
  );
  const [versePlayCount, setVersePlayCount] = useState<number>(1);
  const [settingsModalVisible, setSettingsModalVisible] = useState<boolean>(false);

  // Vocal Pitch Monitor state (Layout 1 Split View)
  const [showPitchMonitor, setShowPitchMonitor] = useState<boolean>(false);
  const [pitchMode, setPitchMode] = useState<PitchPracticeMode>('listen');
  const [echoPass, setEchoPass] = useState<1 | 2>(1);

  const [currentWordIndex, setCurrentWordIndex] = useState<number>(-1);
  const lastWordIndexRef = useRef<number>(-1);
  const lastManualSeekTimestampRef = useRef<number>(0);
  const pendingSeekTargetMsRef = useRef<number | null>(null);
  const isPlayingRef = useRef<boolean>(false);
  const lastReportedPosRef = useRef<number>(0);
  const lastReportedDurRef = useRef<number>(1);

  const currentVerse = useMemo(
    () => verses.find(v => v.numberInSurah === currentVerseNum),
    [verses, currentVerseNum]
  );

  const words = useMemo(() => {
    if (!currentVerse?.arabicText) return [];
    return parseArabicWords(currentVerse.arabicText);
  }, [currentVerse?.arabicText]);

  const currentWordTimings = useMemo(() => {
    if (!currentVerse || words.length === 0) return [];
    const timing = verseTimings[currentVerse.numberInSurah];
    const isTimed = !!currentEffectiveReciter.isSurahBased;
    return getAyahWordTimings(
      timing,
      words,
      !isTimed,
      currentVerseDurationMillis
    );
  }, [
    currentVerse,
    words,
    verseTimings,
    currentEffectiveReciter.isSurahBased,
    currentVerseDurationMillis,
  ]);

  // Refs for tracking state inside status callbacks
  const stateRef = useRef({
    currentVerseNum,
    fromVerse,
    toVerse,
    surah,
    reciter: currentEffectiveReciter,
    loopSettings,
    versePlayCount,
    verses,
    verseTimings,
    currentWordTimings,
    showPitchMonitor,
    pitchMode,
    echoPass,
    isLoopingTransition: false,
  });

  stateRef.current = {
    currentVerseNum,
    fromVerse,
    toVerse,
    surah,
    reciter: currentEffectiveReciter,
    loopSettings,
    versePlayCount,
    verses,
    verseTimings,
    currentWordTimings,
    showPitchMonitor,
    pitchMode,
    echoPass,
    isLoopingTransition: stateRef.current.isLoopingTransition,
  };

  // 1. Initial Verse Loading and Range Background Pre-Caching
  useEffect(() => {
    let isMounted = true;
    (async () => {
      const rec = isMultipleMode ? BASE_RECITERS[0] : reciter;
      prefetchVerseRange(rec, surah.number, fromVerse, toVerse);
      if (isMultipleMode && BASE_RECITERS.length > 1) {
        prefetchVerseRange(BASE_RECITERS[1], surah.number, fromVerse, toVerse);
      }

      const loaded = await getVersesForSurah(surah.number);
      if (!isMounted) return;

      let exactTimings: Record<number, AyahTiming> | null = null;
      if (rec.quranComId) {
        try {
          exactTimings = await fetchSurahVerseTimings(
            rec,
            surah.number,
            loaded,
            durationMillis
          );
        } catch (e) {}
      }

      const initialTimings =
        exactTimings && Object.keys(exactTimings).length > 0
          ? exactTimings
          : getInstantTimings(
              rec,
              surah.number,
              loaded,
              durationMillis > 1000 ? durationMillis : 180000
            );

      if (isMounted) {
        setVerseTimings(initialTimings);
        stateRef.current.verseTimings = initialTimings;
        setVerses(loaded);
      }
    })();

    return () => {
      isMounted = false;
      stopAndUnloadAudio();
    };
  }, [surah.number, reciter.id, fromVerse, toVerse, sessionId]);

  // Re-calculate precise verse timings whenever audio duration is loaded
  const updateTimingsWithDuration = useCallback(
    (totalDurMs: number) => {
      const rec = isMultipleMode ? BASE_RECITERS[multipleReciterIndexRef.current] : reciter;
      if (totalDurMs > 1000 && verses.length > 0) {
        if (!rec.quranComId && !RECITER_TIMINGS[rec.id]?.[surah.number]) {
          const timings = getSurahVerseTimings(
            rec.id,
            surah.number,
            verses,
            totalDurMs
          );
          setVerseTimings(timings);
          stateRef.current.verseTimings = timings;
        }
      }
    },
    [reciter.id, isMultipleMode, surah.number, verses]
  );

  // Determine upcoming ayah for discrete reciters
  const getUpcomingAyah = (currentAyah: number, currentIteration: number) => {
    if (currentIteration < loopSettings.verseRepeatCount) {
      return currentAyah;
    }
    if (loopSettings.mode === 'single') {
      return currentAyah;
    }
    if (currentAyah < toVerse) {
      return currentAyah + 1;
    }
    if (loopSettings.mode === 'range') {
      return fromVerse;
    }
    return null;
  };

  // Preload adjacent verses in background for 0ms Next/Prev skip
  const preloadAdjacentVerses = useCallback(
    (ayahNum: number, iteration: number, activeRec: Reciter) => {
      if (activeRec.isSurahBased) return;
      const upcoming = getUpcomingAyah(ayahNum, iteration);
      if (upcoming !== null && upcoming !== ayahNum) {
        preloadUpcomingVerse(surah.number, upcoming, activeRec, loopSettings.playbackSpeed);
      }
      if (ayahNum + 1 <= toVerse && ayahNum + 1 !== upcoming) {
        preloadUpcomingVerse(surah.number, ayahNum + 1, activeRec, loopSettings.playbackSpeed);
      }
      if (ayahNum > fromVerse) {
        preloadUpcomingVerse(surah.number, ayahNum - 1, activeRec, loopSettings.playbackSpeed);
      }
    },
    [surah.number, fromVerse, toVerse, loopSettings.playbackSpeed, loopSettings.mode, loopSettings.verseRepeatCount]
  );

  // Synchronously reset playhead & duration when transitioning or seeking to an ayah
  const resetPlayheadForAyah = useCallback(
    (targetAyah: number, timingsMap: Record<number, AyahTiming>, seekOffsetMs: number = 0) => {
      stateRef.current.currentVerseNum = targetAyah;
      lastManualSeekTimestampRef.current = Date.now();
      lastReportedPosRef.current = seekOffsetMs;
      lastWordIndexRef.current = -1;
      setCurrentVerseNum(targetAyah);
      setCurrentVersePositionMillis(seekOffsetMs);
      setCurrentWordIndex(-1);

      const t = timingsMap[targetAyah];
      if (t) {
        const dur = Math.max(1, t.endMs - t.startMs);
        lastReportedDurRef.current = dur;
        setCurrentVerseDurationMillis(dur);
        pendingSeekTargetMsRef.current = t.startMs + seekOffsetMs;
      } else {
        pendingSeekTargetMsRef.current = seekOffsetMs;
      }
    },
    []
  );

  // 2. Playback logic
  const playVerse = useCallback(
    async (ayahNum: number, iteration: number = 1, reciterOverride?: Reciter) => {
      const activeRec =
        reciterOverride ||
        (isMultipleMode ? BASE_RECITERS[multipleReciterIndexRef.current] : reciter);
      const isTimed = !!activeRec.isSurahBased;

      let timing = stateRef.current.verseTimings[ayahNum];
      if (!timing) {
        const instant = getInstantTimings(activeRec, surah.number, verses, durationMillis);
        timing = instant[ayahNum];
      }

      stateRef.current.currentVerseNum = ayahNum;
      lastManualSeekTimestampRef.current = Date.now();
      lastReportedPosRef.current = 0;
      lastWordIndexRef.current = -1;

      setCurrentVerseNum(ayahNum);
      setVersePlayCount(iteration);
      setCurrentVersePositionMillis(0);
      setCurrentWordIndex(-1);
      if (timing) {
        const dur = Math.max(1, timing.endMs - timing.startMs);
        lastReportedDurRef.current = dur;
        setCurrentVerseDurationMillis(dur);
      }
      animateVerseChange();

      // Immediately start preloading adjacent verses in parallel!
      preloadAdjacentVerses(ayahNum, iteration, activeRec);

      if (isTimed) {
        const startSeekMs = timing?.startMs || 0;
        pendingSeekTargetMsRef.current = startSeekMs;

        const sound = await loadAndPlayAyah(
          surah.number,
          1,
          activeRec,
          loopSettings.playbackSpeed,
          async status => {
            if (status.isPlaying !== isPlayingRef.current) {
              isPlayingRef.current = status.isPlaying;
              setIsPlaying(status.isPlaying);
            }

            if (status.durationMillis && Math.abs(status.durationMillis - durationMillis) > 100) {
              setDurationMillis(status.durationMillis);
              updateTimingsWithDuration(status.durationMillis);
            }

            if (!status.isPlaying || stateRef.current.isLoopingTransition) return;

            const pos = status.positionMillis;

            // Ignore stale pre-seek playback ticks emitted before the native/web player finishes seeking
            if (pendingSeekTargetMsRef.current !== null) {
              const elapsedSinceSeek = Date.now() - lastManualSeekTimestampRef.current;
              if (elapsedSinceSeek < 650 && Math.abs(pos - pendingSeekTargetMsRef.current) > 450) {
                return;
              }
              pendingSeekTargetMsRef.current = null;
            }

            const {
              currentVerseNum: curr,
              fromVerse: from,
              toVerse: to,
              loopSettings: settings,
              verseTimings: timings,
            } = stateRef.current;

            const isEchoActive =
              stateRef.current.showPitchMonitor && stateRef.current.pitchMode === 'echo';
            const isHoldingSingleAyah =
              isEchoActive || settings.verseRepeatCount > 1 || settings.mode === 'single';

            // 1. Contiguous boundary check FIRST so `activeCurr` is updated BEFORE computing playhead progress!
            let activeCurr = curr;
            if (!isHoldingSingleAyah && Date.now() - lastManualSeekTimestampRef.current > 450) {
              for (let a = from; a <= to; a++) {
                const t = timings[a];
                if (t && pos >= t.startMs && pos < t.endMs) {
                  if (activeCurr !== a) {
                    activeCurr = a;
                    stateRef.current.currentVerseNum = a;
                    setCurrentVerseNum(a);
                    lastWordIndexRef.current = -1;
                    setCurrentWordIndex(-1);
                    const newDur = Math.max(1, t.endMs - t.startMs);
                    const newPos = Math.max(0, Math.min(newDur, pos - t.startMs));
                    lastReportedPosRef.current = newPos;
                    lastReportedDurRef.current = newDur;
                    setCurrentVersePositionMillis(newPos);
                    setCurrentVerseDurationMillis(newDur);
                    animateVerseChange();
                    Haptics.selectionAsync().catch(() => {});
                  }
                  break;
                }
              }
            }

            // 2. Update scrubber position within active verse (`activeCurr`)
            if (!isUserScrubbingRef.current) {
              const currentTiming = timings[activeCurr];
              if (currentTiming) {
                const ayahDur = Math.max(1, currentTiming.endMs - currentTiming.startMs);
                const ayahPos = Math.max(0, Math.min(ayahDur, pos - currentTiming.startMs));
                const minDelta = stateRef.current.showPitchMonitor ? 45 : 100;
                if (
                  Math.abs(ayahPos - lastReportedPosRef.current) >= minDelta ||
                  ayahPos === 0 ||
                  ayahPos >= ayahDur - 80
                ) {
                  lastReportedPosRef.current = ayahPos;
                  setCurrentVersePositionMillis(ayahPos);
                }
                if (Math.abs(ayahDur - lastReportedDurRef.current) > 30) {
                  lastReportedDurRef.current = ayahDur;
                  setCurrentVerseDurationMillis(ayahDur);
                }
              }
            }

            // 3. Word-by-word active highlight tracking
            const wordTimings = stateRef.current.currentWordTimings;
            if (wordTimings && wordTimings.length > 0) {
              let activeWord = -1;
              for (let w = 0; w < wordTimings.length; w++) {
                if (pos >= wordTimings[w].startMs && pos < wordTimings[w].endMs) {
                  activeWord = w;
                  break;
                }
              }
              if (activeWord === -1 && pos >= wordTimings[wordTimings.length - 1].endMs) {
                activeWord = wordTimings.length;
              }
              if (activeWord !== lastWordIndexRef.current) {
                lastWordIndexRef.current = activeWord;
                setCurrentWordIndex(activeWord);
              }
            }

            // 4. Boundary checking for loops (and Auto-Echo pass alternation):
            if (isHoldingSingleAyah) {
              const currentTiming = timings[activeCurr];
              if (currentTiming && pos >= currentTiming.endMs - 120) {
                handleTimedVerseFinished();
              }
            } else if (settings.mode === 'range') {
              const rangeEndTiming = timings[to];
              if (rangeEndTiming && pos >= rangeEndTiming.endMs - 120) {
                handleTimedVerseFinished();
              }
            } else if (settings.mode === 'off') {
              const rangeEndTiming = timings[to];
              if (rangeEndTiming && pos >= rangeEndTiming.endMs - 120) {
                pauseAudio();
                isPlayingRef.current = false;
                setIsPlaying(false);
              }
            } else if (status.didJustFinish) {
              isPlayingRef.current = false;
              setIsPlaying(false);
            }
          },
          startSeekMs
        );

        if (sound) {
          isPlayingRef.current = true;
          setIsPlaying(true);
        }
      } else {
        pendingSeekTargetMsRef.current = 0;

        const sound = await loadAndPlayAyah(
          surah.number,
          ayahNum,
          activeRec,
          loopSettings.playbackSpeed,
          status => {
            if (status.isPlaying !== isPlayingRef.current) {
              isPlayingRef.current = status.isPlaying;
              setIsPlaying(status.isPlaying);
            }

            if (status.didJustFinish) {
              handleDiscreteVerseFinished();
              return;
            }

            const pos = status.positionMillis || 0;
            if (pendingSeekTargetMsRef.current !== null) {
              const elapsedSinceSeek = Date.now() - lastManualSeekTimestampRef.current;
              if (elapsedSinceSeek < 500 && Math.abs(pos - pendingSeekTargetMsRef.current) > 450) {
                return;
              }
              pendingSeekTargetMsRef.current = null;
            }

            if (!isUserScrubbingRef.current) {
              const dur = status.durationMillis || 1;
              const minDelta = stateRef.current.showPitchMonitor ? 45 : 100;
              if (
                Math.abs(pos - lastReportedPosRef.current) >= minDelta ||
                pos === 0 ||
                pos >= dur - 80
              ) {
                lastReportedPosRef.current = pos;
                setCurrentVersePositionMillis(pos);
              }
              if (status.durationMillis && status.durationMillis > 0 && Math.abs(status.durationMillis - lastReportedDurRef.current) > 30) {
                lastReportedDurRef.current = status.durationMillis;
                setCurrentVerseDurationMillis(status.durationMillis);
              }
            }

            // Word-by-word active highlight tracking for discrete reciters
            const dPos = status.positionMillis || 0;
            const wordTimings = stateRef.current.currentWordTimings;
            if (wordTimings && wordTimings.length > 0) {
              let activeWord = -1;
              for (let w = 0; w < wordTimings.length; w++) {
                if (dPos >= wordTimings[w].startMs && dPos < wordTimings[w].endMs) {
                  activeWord = w;
                  break;
                }
              }
              if (activeWord === -1 && dPos >= wordTimings[wordTimings.length - 1].endMs) {
                activeWord = wordTimings.length;
              }
              if (activeWord !== lastWordIndexRef.current) {
                lastWordIndexRef.current = activeWord;
                setCurrentWordIndex(activeWord);
              }
            }
          },
          0
        );

        if (sound) {
          isPlayingRef.current = true;
          setIsPlaying(true);
        }
      }
    },
    [
      surah.number,
      reciter,
      isMultipleMode,
      loopSettings.playbackSpeed,
      loopSettings.mode,
      loopSettings.verseRepeatCount,
      durationMillis,
      updateTimingsWithDuration,
      animateVerseChange,
      preloadAdjacentVerses,
      verses,
    ]
  );

  // Auto-play when verses and timings are loaded for this session
  const lastSessionKeyRef = useRef<string>('');
  useEffect(() => {
    const sessionKey = `${surah.number}_${fromVerse}_${toVerse}_${reciter.id}_${sessionId || 0}`;
    if (verses.length > 0 && lastSessionKeyRef.current !== sessionKey) {
      lastSessionKeyRef.current = sessionKey;
      playVerse(fromVerse, 1);
      recordListenSession(surah, fromVerse, toVerse, currentEffectiveReciter).catch(() => {});
    }
  }, [verses, fromVerse, toVerse, surah.number, reciter.id, sessionId, playVerse, currentEffectiveReciter]);

  // Advance to next reciter when a loop cycle completes in Multiple Reciters mode
  const advanceToNextReciterAndLoop = async (targetAyah: number) => {
    stateRef.current.isLoopingTransition = true;
    const nextIndex = (multipleReciterIndexRef.current + 1) % BASE_RECITERS.length;
    multipleReciterIndexRef.current = nextIndex;
    setMultipleReciterIndex(nextIndex);

    const nextReciter = BASE_RECITERS[nextIndex];
    stateRef.current.reciter = nextReciter;

    // 1. Prepare timings for next reciter
    const nextTimings = getInstantTimings(
      nextReciter,
      surah.number,
      verses,
      durationMillis > 1000 ? durationMillis : 180000
    );
    setVerseTimings(nextTimings);
    stateRef.current.verseTimings = nextTimings;

    if (nextReciter.quranComId) {
      fetchSurahVerseTimings(nextReciter, surah.number, verses).then(exact => {
        if (exact && Object.keys(exact).length > 0) {
          setVerseTimings(exact);
          stateRef.current.verseTimings = exact;
        }
      }).catch(() => {});
    }

    // 2. Play starting verse with next reciter
    await playVerse(targetAyah, 1, nextReciter);
    stateRef.current.isLoopingTransition = false;

    // 3. Pre-fetch upcoming reciter after that
    const afterNextIdx = (nextIndex + 1) % BASE_RECITERS.length;
    prefetchVerseRange(BASE_RECITERS[afterNextIdx], surah.number, fromVerse, toVerse);
  };

  // 3. Handle completion for TIMED continuous reciters
  const handleTimedVerseFinished = async () => {
    if (stateRef.current.isLoopingTransition) return;
    stateRef.current.isLoopingTransition = true;

    const {
      currentVerseNum: curr,
      fromVerse: from,
      toVerse: to,
      loopSettings: settings,
      versePlayCount: count,
      verseTimings: timings,
    } = stateRef.current;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    if (settings.delayBetweenVersesSeconds > 0) {
      await pauseAudio();
      await new Promise(res =>
        setTimeout(res, settings.delayBetweenVersesSeconds * 1000)
      );
    }

    // Auto-Echo mode alternation: Pass 1 (Listen to Reciter) -> Pass 2 (Your Mic Turn on same verse)
    if (stateRef.current.showPitchMonitor && stateRef.current.pitchMode === 'echo') {
      if (stateRef.current.echoPass === 1) {
        stateRef.current.echoPass = 2;
        setEchoPass(2);
        resetPlayheadForAyah(curr, timings, 0);
        const timing = timings[curr];
        if (timing) await seekAudio(timing.startMs);
        await resumeAudio();
        stateRef.current.isLoopingTransition = false;
        return;
      } else {
        stateRef.current.echoPass = 1;
        setEchoPass(1);
      }
    }

    if (count < settings.verseRepeatCount) {
      setVersePlayCount(count + 1);
      resetPlayheadForAyah(curr, timings, 0);
      const timing = timings[curr];
      if (timing) await seekAudio(timing.startMs);
      await resumeAudio();
      stateRef.current.isLoopingTransition = false;
      return;
    }

    // Individual repeat count satisfied for this verse
    setVersePlayCount(1);

    if (settings.mode === 'single') {
      if (isMultipleMode) {
        await advanceToNextReciterAndLoop(curr);
      } else {
        resetPlayheadForAyah(curr, timings, 0);
        const timing = timings[curr];
        if (timing) await seekAudio(timing.startMs);
        await resumeAudio();
        stateRef.current.isLoopingTransition = false;
      }
    } else if (settings.mode === 'range') {
      if (curr >= to) {
        if (isMultipleMode) {
          await advanceToNextReciterAndLoop(from);
        } else {
          resetPlayheadForAyah(from, timings, 0);
          animateVerseChange();
          const timing = timings[from];
          if (timing) await seekAudio(timing.startMs);
          await resumeAudio();
          stateRef.current.isLoopingTransition = false;
        }
      } else {
        const nextAyah = curr + 1;
        resetPlayheadForAyah(nextAyah, timings, 0);
        animateVerseChange();
        const timing = timings[nextAyah];
        if (timing) await seekAudio(timing.startMs);
        await resumeAudio();
        stateRef.current.isLoopingTransition = false;
      }
    } else {
      await pauseAudio();
      setIsPlaying(false);
      stateRef.current.isLoopingTransition = false;
    }
  };

  // 4. Handle completion for DISCRETE verse-by-verse reciters
  const handleDiscreteVerseFinished = async () => {
    const {
      currentVerseNum: curr,
      fromVerse: from,
      toVerse: to,
      loopSettings: settings,
      versePlayCount: count,
    } = stateRef.current;

    if (settings.delayBetweenVersesSeconds > 0) {
      await new Promise(res =>
        setTimeout(res, settings.delayBetweenVersesSeconds * 1000)
      );
    }

    // Auto-Echo mode alternation for discrete reciters: Pass 1 -> Pass 2 on same verse
    if (stateRef.current.showPitchMonitor && stateRef.current.pitchMode === 'echo') {
      if (stateRef.current.echoPass === 1) {
        stateRef.current.echoPass = 2;
        setEchoPass(2);
        playVerse(curr, count);
        return;
      } else {
        stateRef.current.echoPass = 1;
        setEchoPass(1);
      }
    }

    if (count < settings.verseRepeatCount) {
      playVerse(curr, count + 1);
      return;
    }

    // Individual repeat satisfied
    setVersePlayCount(1);

    if (settings.mode === 'single') {
      if (isMultipleMode) {
        await advanceToNextReciterAndLoop(curr);
      } else {
        playVerse(curr, 1);
      }
    } else if (settings.mode === 'range') {
      if (curr < to) {
        playVerse(curr + 1, 1);
      } else {
        if (isMultipleMode) {
          await advanceToNextReciterAndLoop(from);
        } else {
          playVerse(from, 1);
        }
      }
    } else {
      if (curr < to) {
        playVerse(curr + 1, 1);
      } else {
        if (isMultipleMode) {
          await advanceToNextReciterAndLoop(from);
        } else {
          playVerse(from, 1);
        }
      }
    }
  };

  const handleTogglePlayPause = useCallback(() => {
    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      pauseAudio();
    } else {
      isPlayingRef.current = true;
      setIsPlaying(true);
      resumeAudio().then(resumed => {
        if (!resumed) {
          playVerse(stateRef.current.currentVerseNum, 1);
        }
      });
    }
  }, [playVerse]);

  const handleExternalPause = useCallback(() => {
    if (!isPlayingRef.current) return;
    isPlayingRef.current = false;
    setIsPlaying(false);
    pauseAudio();
  }, []);

  const handleExternalPlay = useCallback(() => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;
    setIsPlaying(true);
    resumeAudio().then(resumed => {
      if (!resumed) {
        playVerse(stateRef.current.currentVerseNum, 1);
      }
    });
  }, [playVerse]);

  // Sync metadata + playhead to Dynamic Island / Lock Screen / CarPlay Now Playing and parent mini-player
  useEffect(() => {
    updateCarPlayState({
      currentSurah: surah,
      currentVerseNum,
      fromVerse,
      toVerse,
      reciter: currentEffectiveReciter,
      isPlaying,
      positionMillis: currentVersePositionMillis,
      durationMillis: currentVerseDurationMillis,
      playbackRate: loopSettings.playbackSpeed,
    });
  }, [
    isPlaying,
    currentVerseNum,
    fromVerse,
    toVerse,
    surah,
    currentEffectiveReciter,
    currentVersePositionMillis,
    currentVerseDurationMillis,
    loopSettings.playbackSpeed,
  ]);

  useEffect(() => {
    if (onPlaybackStateChange) {
      onPlaybackStateChange({
        isPlaying,
        currentVerseNum,
        togglePlayPause: handleTogglePlayPause,
        currentReciterName: currentEffectiveReciter.shortName,
      });
    }
  }, [isPlaying, currentVerseNum, currentEffectiveReciter, onPlaybackStateChange, handleTogglePlayPause]);

  // Clear system Now Playing card when leaving the player
  useEffect(() => {
    return () => {
      clearNowPlayingState();
    };
  }, []);

  const handleSeekingChange = useCallback((isSeeking: boolean) => {
    isUserScrubbingRef.current = isSeeking;
  }, []);

  const handleSeekAyah = useCallback(
    async (targetAyah: number, seekFraction: number = 0) => {
      isUserScrubbingRef.current = false;
      lastManualSeekTimestampRef.current = Date.now();

      if (isTimedReciter && isAudioLoaded()) {
        const timing = stateRef.current.verseTimings[targetAyah];
        if (timing) {
          const ayahDuration = Math.max(1, timing.endMs - timing.startMs);
          const seekOffsetMs = Math.round(seekFraction * ayahDuration);
          const targetPosMs = timing.startMs + seekOffsetMs;
          const ayahChanged = targetAyah !== stateRef.current.currentVerseNum;

          resetPlayheadForAyah(targetAyah, stateRef.current.verseTimings, seekOffsetMs);
          if (ayahChanged) {
            animateVerseChange();
          }
          seekAudio(targetPosMs);
        }
      } else {
        if (targetAyah !== stateRef.current.currentVerseNum || !isAudioLoaded()) {
          await playVerse(targetAyah, 1, currentEffectiveReciter);
          if (seekFraction > 0) {
            const dur = currentVerseDurationMillis > 1 ? currentVerseDurationMillis : 10000;
            const seekPosMs = Math.round(seekFraction * dur);
            lastManualSeekTimestampRef.current = Date.now();
            pendingSeekTargetMsRef.current = seekPosMs;
            lastReportedPosRef.current = seekPosMs;
            setCurrentVersePositionMillis(seekPosMs);
            seekAudio(seekPosMs);
          }
        } else {
          const dur = currentVerseDurationMillis > 1 ? currentVerseDurationMillis : 10000;
          const seekPosMs = Math.round(seekFraction * dur);
          lastManualSeekTimestampRef.current = Date.now();
          pendingSeekTargetMsRef.current = seekPosMs;
          lastReportedPosRef.current = seekPosMs;
          setCurrentVersePositionMillis(seekPosMs);
          seekAudio(seekPosMs);
        }
      }
    },
    [isTimedReciter, animateVerseChange, playVerse, currentVerseDurationMillis, currentEffectiveReciter, resetPlayheadForAyah]
  );

  const handlePreviousVerse = useCallback(() => {
    const curr = stateRef.current.currentVerseNum;
    const prevAyah = Math.max(fromVerse, curr - 1);

    if (isTimedReciter && isAudioLoaded()) {
      resetPlayheadForAyah(prevAyah, stateRef.current.verseTimings, 0);
      animateVerseChange();
      const timing = stateRef.current.verseTimings[prevAyah];
      if (timing) {
        seekAudio(timing.startMs);
      }
    } else {
      playVerse(prevAyah, 1, currentEffectiveReciter);
    }
  }, [fromVerse, isTimedReciter, animateVerseChange, playVerse, currentEffectiveReciter, resetPlayheadForAyah]);

  const handleNextVerse = useCallback(() => {
    const curr = stateRef.current.currentVerseNum;
    const nextAyah = Math.min(toVerse, curr + 1);

    if (isTimedReciter && isAudioLoaded()) {
      resetPlayheadForAyah(nextAyah, stateRef.current.verseTimings, 0);
      animateVerseChange();
      const timing = stateRef.current.verseTimings[nextAyah];
      if (timing) {
        seekAudio(timing.startMs);
      }
    } else {
      playVerse(nextAyah, 1, currentEffectiveReciter);
    }
  }, [toVerse, isTimedReciter, animateVerseChange, playVerse, currentEffectiveReciter, resetPlayheadForAyah]);

  // Dynamic Island / Lock Screen / CarPlay / steering-wheel remote commands + audio route loss handling.
  // Handlers are read through a ref so the native listeners are registered exactly once.
  const nowPlayingHandlersRef = useRef({
    handleExternalPlay,
    handleExternalPause,
    handleTogglePlayPause,
    handleNextVerse,
    handlePreviousVerse,
    handleSeekAyah,
  });
  nowPlayingHandlersRef.current = {
    handleExternalPlay,
    handleExternalPause,
    handleTogglePlayPause,
    handleNextVerse,
    handlePreviousVerse,
    handleSeekAyah,
  };

  useEffect(() => {
    const unsubscribe = registerNowPlayingHandlers({
      onPlay: () => nowPlayingHandlersRef.current.handleExternalPlay(),
      onPause: () => nowPlayingHandlersRef.current.handleExternalPause(),
      onTogglePlayPause: () => nowPlayingHandlersRef.current.handleTogglePlayPause(),
      onNext: () => nowPlayingHandlersRef.current.handleNextVerse(),
      onPrevious: () => nowPlayingHandlersRef.current.handlePreviousVerse(),
      onSeekToSeconds: positionSec => {
        const dur = Math.max(1, lastReportedDurRef.current);
        const fraction = Math.max(0, Math.min(0.995, (positionSec * 1000) / dur));
        nowPlayingHandlersRef.current.handleSeekAyah(stateRef.current.currentVerseNum, fraction);
      },
      // Car muted / CarPlay or Bluetooth disconnected: pause instead of continuing on the iPhone speaker
      onAudioRouteLost: () => nowPlayingHandlersRef.current.handleExternalPause(),
      onInterruptionBegan: () => nowPlayingHandlersRef.current.handleExternalPause(),
    });
    return unsubscribe;
  }, []);

  const handleToggleLoopMode = useCallback(() => {
    const modes: LoopSettings['mode'][] = ['range', 'single', 'off'];
    setLoopSettings(prev => {
      const nextIdx = (modes.indexOf(prev.mode) + 1) % modes.length;
      return { ...prev, mode: modes[nextIdx] };
    });
  }, []);

  const totalVersesInRange = Math.max(1, toVerse - fromVerse + 1);

  // Show Bismillah header if non-Fatihah and non-Tawbah on Ayah 1
  const showBismillahHeader = surah.number !== 1 && surah.number !== 9 && currentVerseNum === 1;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#080b11" />

      {/* 1. TOP HEADER WITH VIEW SWITCHER (Recitation | Pitch Match) */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.navBtn} onPress={onMinimize}>
          <Ionicons name="chevron-down" size={24} color="#ffffff" />
        </TouchableOpacity>

        <View style={styles.headerModePill}>
          <TouchableOpacity
            style={[
              styles.headerModeTab,
              !showPitchMonitor && styles.headerModeTabActive,
            ]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setShowPitchMonitor(false);
            }}
          >
            <Ionicons
              name="book-outline"
              size={13}
              color={!showPitchMonitor ? '#9bbfff' : '#7e8ca3'}
            />
            <Text
              style={[
                styles.headerModeTabText,
                !showPitchMonitor && styles.headerModeTabTextActive,
              ]}
            >
              Verse
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.headerModeTab,
              showPitchMonitor && styles.headerModeTabActive,
            ]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setShowPitchMonitor(true);
            }}
          >
            <Ionicons
              name="mic-outline"
              size={14}
              color={showPitchMonitor ? '#e5b869' : '#7e8ca3'}
            />
            <Text
              style={[
                styles.headerModeTabText,
                showPitchMonitor && styles.headerModeTabTextGold,
              ]}
            >
              Pitch Match
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => setSettingsModalVisible(true)}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* 2. SURAH TITLE & SUBTITLE WITH DANCING SOUNDWAVE */}
      <View style={[styles.titleSection, showPitchMonitor && styles.titleSectionCompact]}>
        <Text style={[styles.surahTitle, showPitchMonitor && styles.surahTitleCompact]}>
          Surah {surah.englishName}
        </Text>
        <View style={styles.subtitleRow}>
          {isMultipleMode && (
            <View style={styles.multipleModeBadge}>
              <Ionicons name="repeat" size={12} color="#e5b869" style={{ marginRight: 4 }} />
              <Text style={styles.multipleModeText}>Multiple</Text>
            </View>
          )}
          <Text style={styles.surahSubtitle}>
            {isMultipleMode ? currentEffectiveReciter.name : reciter.name}
          </Text>
          <SoundwaveVisualizer isPlaying={isPlaying} color="#9bbfff" barCount={4} maxHeight={14} />
        </View>
      </View>

      {/* 3. MIDDLE SECTION: QURAN CARD (+ REAL-TIME VOCAL PITCH MONITOR IN SPLIT VIEW) */}
      <View style={styles.middleSplitContainer}>
        <QuranCardView
          currentVerse={currentVerse}
          currentVerseNum={currentVerseNum}
          showBismillahHeader={showBismillahHeader}
          cardOpacity={cardOpacity}
          cardScale={cardScale}
          cardSlideX={cardSlideX}
          auraGlow={auraGlow}
          currentWordIndex={currentWordIndex}
          words={words}
          compact={showPitchMonitor}
        />

        {showPitchMonitor && (
          <View style={styles.pitchMonitorWrapper}>
            <VocalPitchMonitor
              surahNumber={surah.number}
              ayahNumber={currentVerseNum}
              words={words}
              wordTimings={currentWordTimings}
              reciter={currentEffectiveReciter}
              positionMillis={currentVersePositionMillis}
              durationMillis={currentVerseDurationMillis}
              ayahStartMs={verseTimings[currentVerseNum]?.startMs || 0}
              ayahEndMs={verseTimings[currentVerseNum]?.endMs || 0}
              totalTrackDurationMs={durationMillis}
              isPlaying={isPlaying}
              echoPass={echoPass}
              mode={pitchMode}
              onChangeMode={newMode => {
                setPitchMode(newMode);
                setEchoPass(1);
                stateRef.current.echoPass = 1;
              }}
              onSeekFraction={fraction => {
                handleSeekAyah(currentVerseNum, fraction);
              }}
            />
          </View>
        )}
      </View>

      {/* 4. PERMANENTLY STATIC BOTTOM SECTION WITH SCRUBBER & CONTROLS */}
      <View style={styles.bottomSection}>
        {/* Interactive Scrubber Bar */}
        <SegmentedPlaybackBar
          fromVerse={fromVerse}
          toVerse={toVerse}
          currentVerseNum={currentVerseNum}
          positionMillis={currentVersePositionMillis}
          durationMillis={currentVerseDurationMillis}
          onSeekAyah={handleSeekAyah}
          onSeekingChange={handleSeekingChange}
        />

        {/* Simplified Verse Indicator: e.g. Verse 5/7 */}
        <View style={styles.verseIndicatorBanner}>
          <Text style={styles.verseIndicatorText}>
            Verse {currentVerseNum}/{toVerse}
          </Text>

          {loopSettings.verseRepeatCount > 1 && (
            <View style={styles.repeatBadge}>
              <Text style={styles.repeatBadgeText}>
                {versePlayCount}/{loopSettings.verseRepeatCount}
              </Text>
            </View>
          )}
        </View>

        {/* Minimalist Controls with Instant Touch-Down Response */}
        <View style={styles.controlsRow}>
          <BouncyTouchable
            style={styles.controlIconBtn}
            onPress={() => setSettingsModalVisible(true)}
          >
            <Feather name="sliders" size={20} color="#8a95aa" />
          </BouncyTouchable>

          <BouncyTouchable
            style={styles.controlIconBtn}
            triggerOnPressIn={true}
            onPress={handlePreviousVerse}
          >
            <MaterialIcons name="skip-previous" size={30} color="#ffffff" />
          </BouncyTouchable>

          {/* Bouncy Play/Pause Button */}
          <BouncyTouchable
            style={styles.playPauseBtn}
            triggerOnPressIn={true}
            onPress={handleTogglePlayPause}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={32}
              color="#0a101d"
              style={!isPlaying ? { marginLeft: 3 } : undefined}
            />
          </BouncyTouchable>

          <BouncyTouchable
            style={styles.controlIconBtn}
            triggerOnPressIn={true}
            onPress={handleNextVerse}
          >
            <MaterialIcons name="skip-next" size={30} color="#ffffff" />
          </BouncyTouchable>

          <BouncyTouchable
            style={[
              styles.controlIconBtn,
              loopSettings.mode !== 'off' && styles.loopActiveBtn,
            ]}
            triggerOnPressIn={true}
            onPress={handleToggleLoopMode}
          >
            <Ionicons
              name={loopSettings.mode === 'single' ? 'repeat-outline' : 'repeat'}
              size={22}
              color={loopSettings.mode !== 'off' ? '#9bbfff' : '#8a95aa'}
            />
            {loopSettings.mode !== 'off' && <View style={styles.loopDot} />}
          </BouncyTouchable>
        </View>
      </View>

      {/* Settings Modal */}
      <LoopSettingsModal
        visible={settingsModalVisible}
        settings={loopSettings}
        onUpdateSettings={newSettings => {
          setLoopSettings(newSettings);
          setAudioRate(newSettings.playbackSpeed);
        }}
        onClose={() => setSettingsModalVisible(false)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080b11',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#151d2d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerModePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0e1422',
    borderRadius: 18,
    padding: 3,
    borderWidth: 1,
    borderColor: '#1e2a42',
  },
  headerModeTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  headerModeTabActive: {
    backgroundColor: '#18243a',
    borderWidth: 1,
    borderColor: '#2a3e63',
  },
  headerModeTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7e8ca3',
  },
  headerModeTabTextActive: {
    color: '#9bbfff',
    fontWeight: '700',
  },
  headerModeTabTextGold: {
    color: '#e5b869',
    fontWeight: '700',
  },
  titleSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  titleSectionCompact: {
    paddingTop: 2,
    paddingBottom: 4,
  },
  surahTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  surahTitleCompact: {
    fontSize: 19,
    marginBottom: 2,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  surahSubtitle: {
    fontSize: 13,
    color: '#8a95aa',
  },
  multipleModeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#272010',
    borderWidth: 1,
    borderColor: '#6b5424',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    marginRight: 2,
  },
  multipleModeText: {
    color: '#e5b869',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  middleSplitContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  pitchMonitorWrapper: {
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  cardWrapper: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
    justifyContent: 'center',
    position: 'relative',
  },
  cardWrapperCompact: {
    flex: 1,
    paddingVertical: 4,
  },
  ambientAura: {
    position: 'absolute',
    top: 20,
    bottom: 20,
    left: 24,
    right: 24,
    borderRadius: 30,
    backgroundColor: '#1e335a',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 35,
  },
  quranCard: {
    flex: 1,
    backgroundColor: '#121726',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1e283d',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  cardScrollContent: {
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
  },
  cardScrollContentCompact: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bismillahBox: {
    alignItems: 'center',
    marginBottom: 16,
  },
  bismillahText: {
    fontFamily: 'UthmanicHafs',
    fontSize: 22,
    lineHeight: 40,
    color: '#e5b869',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  bismillahUnderline: {
    width: 36,
    height: 1.5,
    backgroundColor: '#a37a34',
    marginTop: 6,
    borderRadius: 1,
  },
  tagBadge: {
    backgroundColor: '#182133',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#23304a',
  },
  tagText: {
    color: '#9bbfff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  arabicText: {
    fontFamily: 'UthmanicHafs',
    fontSize: 28,
    lineHeight: 56,
    color: '#ffffff',
    textAlign: 'center',
    paddingHorizontal: 6,
    marginBottom: 16,
  },
  arabicTextCompact: {
    fontSize: 22,
    lineHeight: 40,
    marginBottom: 6,
  },
  wordBase: {
    fontFamily: 'UthmanicHafs',
    fontSize: 28,
    lineHeight: 56,
    color: '#ffffff',
    textAlign: 'center',
  },
  wordBaseCompact: {
    fontSize: 22,
    lineHeight: 40,
  },
  wordSpoken: {
    color: '#ffffff',
    opacity: 1,
  },
  wordCurrent: {
    color: '#fb923c',
    textShadowColor: 'rgba(249, 115, 22, 0.85)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 11,
    opacity: 1,
  },
  wordUpcoming: {
    color: '#ffffff',
    opacity: 1,
    textShadowRadius: 0,
  },
  ayahEndSymbol: {
    fontFamily: 'UthmanicHafs',
    color: '#9bbfff',
    fontSize: 22,
  },
  ayahEndSymbolCompact: {
    fontSize: 18,
  },
  ayahEndSymbolActive: {
    color: '#fb923c',
    textShadowColor: 'rgba(249, 115, 22, 0.75)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  cardDivider: {
    width: 44,
    height: 2,
    backgroundColor: '#202b42',
    borderRadius: 1,
    marginBottom: 16,
  },
  cardDividerCompact: {
    marginBottom: 6,
  },
  translationText: {
    fontSize: 15,
    lineHeight: 24,
    color: '#cbd5e1',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  translationTextCompact: {
    fontSize: 12.5,
    lineHeight: 18,
  },
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
});
