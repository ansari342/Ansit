import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { getVersesForSurah } from '../services/quranService';
import {
  loadAndPlayAyah,
  preloadUpcomingVerse,
  pauseAudio,
  resumeAudio,
  seekAudio,
  stopAndUnloadAudio,
  setAudioRate,
} from '../services/audioService';
import { prefetchVerseRange } from '../services/cacheService';
import { LoopSettingsModal } from './LoopSettingsModal';
import {
  AyahTiming,
  RECITER_TIMINGS,
  getSurahVerseTimings,
} from '../data/reciterTimings';
import { BASE_RECITERS } from '../data/reciters';
import {
  getInstantTimings,
  fetchSurahVerseTimings,
} from '../services/timingService';
import { SoundwaveVisualizer } from './SoundwaveVisualizer';
import { BouncyTouchable } from './BouncyTouchable';
import { SegmentedPlaybackBar } from './SegmentedPlaybackBar';
import { updateCarPlayState } from '../services/carPlayService';

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

export const NowPlayingScreen: React.FC<NowPlayingScreenProps> = ({
  surah,
  fromVerse,
  toVerse,
  reciter,
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
      if (isMounted) {
        setVerses(loaded);
        const initialTimings = getInstantTimings(
          rec,
          surah.number,
          loaded,
          durationMillis > 1000 ? durationMillis : 180000
        );
        setVerseTimings(initialTimings);
        stateRef.current.verseTimings = initialTimings;

        if (rec.quranComId) {
          fetchSurahVerseTimings(
            rec,
            surah.number,
            loaded,
            durationMillis
          )
            .then(exactTimings => {
              if (isMounted && exactTimings && Object.keys(exactTimings).length > 0) {
                setVerseTimings(exactTimings);
                stateRef.current.verseTimings = exactTimings;
              }
            })
            .catch(() => {});
        }
      }
    })();

    return () => {
      isMounted = false;
      stopAndUnloadAudio();
    };
  }, [surah.number, reciter.id, fromVerse, toVerse]);

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

  // 2. Playback logic
  const playVerse = useCallback(
    async (ayahNum: number, iteration: number = 1, reciterOverride?: Reciter) => {
      const activeRec =
        reciterOverride ||
        (isMultipleMode ? BASE_RECITERS[multipleReciterIndexRef.current] : reciter);
      const isTimed = !!activeRec.isSurahBased;

      setCurrentVerseNum(ayahNum);
      setVersePlayCount(iteration);
      setCurrentVersePositionMillis(0);
      animateVerseChange();

      if (isTimed) {
        let timing = stateRef.current.verseTimings[ayahNum];
        if (!timing) {
          const instant = getInstantTimings(activeRec, surah.number, verses, durationMillis);
          timing = instant[ayahNum];
        }
        const startSeekMs = timing?.startMs || 0;
        if (timing) {
          setCurrentVerseDurationMillis(Math.max(1, timing.endMs - timing.startMs));
        }

        const sound = await loadAndPlayAyah(
          surah.number,
          1,
          activeRec,
          loopSettings.playbackSpeed,
          async status => {
            setIsPlaying(status.isPlaying);

            if (status.durationMillis && status.durationMillis !== durationMillis) {
              setDurationMillis(status.durationMillis);
              updateTimingsWithDuration(status.durationMillis);
            }

            if (!status.isPlaying || stateRef.current.isLoopingTransition) return;

            const pos = status.positionMillis;
            const {
              currentVerseNum: curr,
              fromVerse: from,
              toVerse: to,
              loopSettings: settings,
              verseTimings: timings,
            } = stateRef.current;

            // Update scrubber position within current verse
            if (!isUserScrubbingRef.current) {
              const currentTiming = timings[curr];
              if (currentTiming) {
                const ayahDur = Math.max(1, currentTiming.endMs - currentTiming.startMs);
                const ayahPos = Math.max(0, Math.min(ayahDur, pos - currentTiming.startMs));
                setCurrentVersePositionMillis(ayahPos);
                setCurrentVerseDurationMillis(ayahDur);
              }
            }

            // Contiguous boundary check: smoothly updates current verse as audio plays gaplessly
            for (let a = from; a <= to; a++) {
              const t = timings[a];
              if (t && pos >= t.startMs && pos < t.endMs) {
                if (curr !== a) {
                  setCurrentVerseNum(a);
                  animateVerseChange();
                  try {
                    Haptics.selectionAsync();
                  } catch (e) {}
                }
                break;
              }
            }

            // Boundary checking for loops:
            // When verseRepeatCount === 1 and mode === 'range', audio flows naturally without interruption!
            if (settings.verseRepeatCount > 1) {
              const currentTiming = timings[curr];
              if (currentTiming && pos >= currentTiming.endMs - 120) {
                handleTimedVerseFinished();
              }
            } else if (settings.mode === 'single') {
              const singleTiming = timings[curr];
              if (singleTiming && pos >= singleTiming.endMs - 120) {
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
                setIsPlaying(false);
              }
            } else if (status.didJustFinish) {
              setIsPlaying(false);
            }
          }
        );

        if (sound) {
          setIsPlaying(true);
          try {
            if (startSeekMs > 0) {
              await sound.setPositionAsync(startSeekMs);
            }
          } catch (e) {}
        }
      } else {
        const sound = await loadAndPlayAyah(
          surah.number,
          ayahNum,
          activeRec,
          loopSettings.playbackSpeed,
          status => {
            setIsPlaying(status.isPlaying);

            if (!isUserScrubbingRef.current) {
              setCurrentVersePositionMillis(status.positionMillis || 0);
              if (status.durationMillis && status.durationMillis > 0) {
                setCurrentVerseDurationMillis(status.durationMillis);
              }
            }

            if (status.didJustFinish) {
              handleDiscreteVerseFinished();
            }
          }
        );

        if (sound) {
          setIsPlaying(true);
          const upcoming = getUpcomingAyah(ayahNum, iteration);
          if (upcoming !== null) {
            preloadUpcomingVerse(
              surah.number,
              upcoming,
              activeRec,
              loopSettings.playbackSpeed
            );
          }
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
      verses,
    ]
  );

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

    if (count < settings.verseRepeatCount) {
      setVersePlayCount(count + 1);
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
          setCurrentVerseNum(from);
          animateVerseChange();
          const timing = timings[from];
          if (timing) await seekAudio(timing.startMs);
          await resumeAudio();
          stateRef.current.isLoopingTransition = false;
        }
      } else {
        const nextAyah = curr + 1;
        setCurrentVerseNum(nextAyah);
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

    if (count < settings.verseRepeatCount) {
      playVerse(curr, count + 1);
      return;
    }

    if (settings.mode === 'single') {
      if (isMultipleMode) {
        await advanceToNextReciterAndLoop(curr);
      } else {
        playVerse(curr, 1);
      }
      return;
    }

    if (curr < to) {
      playVerse(curr + 1, 1);
    } else {
      if (settings.mode === 'range') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (isMultipleMode) {
          await advanceToNextReciterAndLoop(from);
        } else {
          playVerse(from, 1);
        }
      } else {
        setIsPlaying(false);
      }
    }
  };

  const handleTogglePlayPause = async () => {
    if (isPlaying) {
      await pauseAudio();
      setIsPlaying(false);
    } else {
      await resumeAudio();
      setIsPlaying(true);
    }
  };

  // Sync state to parent mini-player and CarPlay
  useEffect(() => {
    updateCarPlayState({
      currentSurah: surah,
      currentVerseNum,
      reciter: currentEffectiveReciter,
      isPlaying,
    });

    if (onPlaybackStateChange) {
      onPlaybackStateChange({
        isPlaying,
        currentVerseNum,
        togglePlayPause: handleTogglePlayPause,
        currentReciterName: currentEffectiveReciter.shortName,
      });
    }
  }, [isPlaying, currentVerseNum, surah, currentEffectiveReciter, onPlaybackStateChange]);

  const handleSeekingChange = useCallback((isSeeking: boolean) => {
    isUserScrubbingRef.current = isSeeking;
  }, []);

  const handleSeekAyah = useCallback(
    async (targetAyah: number, seekFraction: number = 0) => {
      isUserScrubbingRef.current = false;
      if (isTimedReciter) {
        const timing = stateRef.current.verseTimings[targetAyah];
        if (timing) {
          const ayahDuration = Math.max(1, timing.endMs - timing.startMs);
          const seekOffsetMs = Math.round(seekFraction * ayahDuration);
          const targetPosMs = timing.startMs + seekOffsetMs;

          if (targetAyah !== stateRef.current.currentVerseNum) {
            setCurrentVerseNum(targetAyah);
            animateVerseChange();
          }

          setCurrentVersePositionMillis(seekOffsetMs);
          setCurrentVerseDurationMillis(ayahDuration);
          await seekAudio(targetPosMs);
        }
      } else {
        if (targetAyah !== stateRef.current.currentVerseNum) {
          await playVerse(targetAyah, 1, currentEffectiveReciter);
          if (seekFraction > 0) {
            const dur = currentVerseDurationMillis > 1 ? currentVerseDurationMillis : 10000;
            const seekPosMs = Math.round(seekFraction * dur);
            setCurrentVersePositionMillis(seekPosMs);
            await seekAudio(seekPosMs);
          }
        } else {
          const dur = currentVerseDurationMillis > 1 ? currentVerseDurationMillis : 10000;
          const seekPosMs = Math.round(seekFraction * dur);
          setCurrentVersePositionMillis(seekPosMs);
          await seekAudio(seekPosMs);
        }
      }
    },
    [isTimedReciter, animateVerseChange, playVerse, currentVerseDurationMillis, currentEffectiveReciter]
  );

  const handlePreviousVerse = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {}

    const prevAyah = Math.max(fromVerse, currentVerseNum - 1);
    if (isTimedReciter) {
      setCurrentVerseNum(prevAyah);
      animateVerseChange();
      const timing = stateRef.current.verseTimings[prevAyah];
      if (timing) await seekAudio(timing.startMs);
    } else {
      playVerse(prevAyah, 1, currentEffectiveReciter);
    }
  };

  const handleNextVerse = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {}

    const nextAyah = Math.min(toVerse, currentVerseNum + 1);
    if (isTimedReciter) {
      setCurrentVerseNum(nextAyah);
      animateVerseChange();
      const timing = stateRef.current.verseTimings[nextAyah];
      if (timing) await seekAudio(timing.startMs);
    } else {
      playVerse(nextAyah, 1, currentEffectiveReciter);
    }
  };

  const handleToggleLoopMode = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch (e) {}

    const modes: LoopSettings['mode'][] = ['range', 'single', 'off'];
    const nextIdx = (modes.indexOf(loopSettings.mode) + 1) % modes.length;
    setLoopSettings(prev => ({ ...prev, mode: modes[nextIdx] }));
  };

  const currentVerse = verses.find(v => v.numberInSurah === currentVerseNum);
  const totalVersesInRange = Math.max(1, toVerse - fromVerse + 1);

  // Show Bismillah header if non-Fatihah and non-Tawbah on Ayah 1
  const showBismillahHeader = surah.number !== 1 && surah.number !== 9 && currentVerseNum === 1;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#080b11" />

      {/* 1. TOP HEADER (Without "NOW PLAYING") */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.navBtn} onPress={onMinimize}>
          <Ionicons name="chevron-down" size={24} color="#ffffff" />
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => setSettingsModalVisible(true)}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* 2. SURAH TITLE & SUBTITLE WITH DANCING SOUNDWAVE */}
      <View style={styles.titleSection}>
        <Text style={styles.surahTitle}>Surah {surah.englishName}</Text>
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

      {/* 3. MIDDLE SECTION: QURAN CARD WITH AMBIENT GLOW & SPRING ANIMATION */}
      <View style={styles.cardWrapper}>
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
            contentContainerStyle={styles.cardScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Gilded Bismillah Banner */}
            {showBismillahHeader && (
              <View style={styles.bismillahBox}>
                <Text style={styles.bismillahText}>
                  بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
                </Text>
                <View style={styles.bismillahUnderline} />
              </View>
            )}

            {/* Accurate Arabic Text with End-of-Ayah Ornament */}
            <Text style={styles.arabicText}>
              {currentVerse?.arabicText ? (
                <>
                  {currentVerse.arabicText}
                  <Text style={styles.ayahEndSymbol}>
                    {' '}
                    ﴿{toArabicIndic(currentVerseNum)}﴾
                  </Text>
                </>
              ) : (
                'Loading verse...'
              )}
            </Text>

            <View style={styles.cardDivider} />

            {/* English Translation */}
            <Text style={styles.translationText}>
              "{currentVerse?.englishText || 'Loading translation...'}"
            </Text>
          </ScrollView>
        </Animated.View>
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

        {/* Minimalist Controls with Springy Bouncy Play Button */}
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={styles.controlIconBtn}
            onPress={() => setSettingsModalVisible(true)}
          >
            <Feather name="sliders" size={20} color="#8a95aa" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlIconBtn} onPress={handlePreviousVerse}>
            <MaterialIcons name="skip-previous" size={30} color="#ffffff" />
          </TouchableOpacity>

          {/* Bouncy Play/Pause Button */}
          <BouncyTouchable
            style={styles.playPauseBtn}
            onPress={handleTogglePlayPause}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={32}
              color="#0a101d"
              style={!isPlaying ? { marginLeft: 3 } : undefined}
            />
          </BouncyTouchable>

          <TouchableOpacity style={styles.controlIconBtn} onPress={handleNextVerse}>
            <MaterialIcons name="skip-next" size={30} color="#ffffff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.controlIconBtn,
              loopSettings.mode !== 'off' && styles.loopActiveBtn,
            ]}
            onPress={handleToggleLoopMode}
          >
            <Ionicons
              name={loopSettings.mode === 'single' ? 'repeat-outline' : 'repeat'}
              size={22}
              color={loopSettings.mode !== 'off' ? '#9bbfff' : '#8a95aa'}
            />
            {loopSettings.mode !== 'off' && <View style={styles.loopDot} />}
          </TouchableOpacity>
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
  titleSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  surahTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
    marginBottom: 4,
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
  cardWrapper: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
    justifyContent: 'center',
    position: 'relative',
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
  bismillahBox: {
    alignItems: 'center',
    marginBottom: 16,
  },
  bismillahText: {
    fontSize: 20,
    color: '#e5b869',
    textAlign: 'center',
    fontWeight: '600',
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
    fontSize: 27,
    lineHeight: 52,
    color: '#ffffff',
    textAlign: 'center',
    fontWeight: '600',
    paddingHorizontal: 6,
    marginBottom: 16,
  },
  ayahEndSymbol: {
    color: '#9bbfff',
    fontSize: 22,
    fontWeight: '700',
  },
  cardDivider: {
    width: 44,
    height: 2,
    backgroundColor: '#202b42',
    borderRadius: 1,
    marginBottom: 16,
  },
  translationText: {
    fontSize: 15,
    lineHeight: 24,
    color: '#cbd5e1',
    textAlign: 'center',
    fontStyle: 'italic',
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
