import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Verse } from '../types';
import { WordTiming } from '../data/reciterTimings';
import {
  Take,
  WordMark,
  SlipReason,
  SLIP_REASON_LABEL,
  ENVELOPE_STEP_MS,
  startTakeRecording,
  RecorderHandle,
  getTakesForVerse,
  updateTakeMarks,
  playTake,
  stopTakePlayback,
  detectPauses,
  getWeakWords,
  WeakWord,
} from '../services/takeService';
import {
  buildWordExpectations,
  createInitialTrackerState,
  stepAcousticTracker,
  mergeTranscriptIntoTracker,
  finalizeTakeAutoMarks,
  LiveReciteTrackerState,
} from '../core/reciteTracker';
import {
  isNativePitchDetectorAvailable,
  startNativeSpeechRecognizer,
  stopNativeSpeechRecognizer,
  addNativeSpeechListener,
  Subscription,
} from '../../modules/aya-pitch-detector';
import { colors, space, radius, type, pill } from '../theme';

export type ReciteStage = 'idle' | 'recording' | 'review';

const BISMILLAH_CUE = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';

const toArabicIndic = (num: number): string =>
  num
    .toString()
    .split('')
    .map(d => '٠١٢٣٤٥٦٧٨٩'[parseInt(d, 10)] ?? d)
    .join('');

interface ReciteCorrectProps {
  surahNumber: number;
  verse: number;
  verseData?: Verse;
  /** Preceding verse (verse - 1) so the user knows where to start. */
  previousVerseData?: Verse;
  words: string[];
  wordTimings?: WordTiming[];
  /** Lets the parent render the right center button. */
  onStageChange?: (stage: ReciteStage) => void;
  /** Exposed so the transport's center button can drive record/stop/play. */
  controlRef?: React.MutableRefObject<ReciteControls | null>;
}

export interface ReciteControls {
  primary: () => void; // ● record → ■ stop → ▶ play this take
  playAB: () => void;
  stage: ReciteStage;
}

const REASONS: SlipReason[] = ['forgot', 'wrong', 'tajweed'];

const REASON_COLOR: Record<SlipReason, string> = {
  forgot: '#f59e0b', // Amber for hesitation / forgotten word
  wrong: '#f87171', // Coral red for wrong word
  tajweed: '#60a5fa', // Sapphire blue for Tajweed / rushed Madd
};

/** Envelope → bar heights (0..1), resampled to `bars`. */
function envelopeBars(envelope: number[], bars: number): number[] {
  if (envelope.length === 0) return new Array(bars).fill(0);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const a = Math.floor((i / bars) * envelope.length);
    const b = Math.max(a + 1, Math.floor(((i + 1) / bars) * envelope.length));
    let peak = -160;
    for (let k = a; k < b; k++) peak = Math.max(peak, envelope[k]);
    out.push(Math.max(0, Math.min(1, (peak + 55) / 50)));
  }
  return out;
}

const Lane: React.FC<{ label: string; take: Take | null; tone: 'gold' | 'sapphire'; progressMs: number | null; onPress?: () => void }> = ({
  label,
  take,
  tone,
  progressMs,
  onPress,
}) => {
  const BARS = 48;
  const bars = useMemo(() => (take ? envelopeBars(take.envelope, BARS) : []), [take]);
  const pauses = useMemo(() => (take ? detectPauses(take.envelope) : []), [take]);
  const color = tone === 'gold' ? colors.gold : colors.sapphire;
  const dur = take ? Math.max(1, take.durationMs) : 1;
  return (
    <Pressable onPress={onPress} disabled={!take || !onPress} style={styles.lane}>
      <View style={styles.laneHeader}>
        <Text style={[styles.laneLabel, { color }]}>{label}</Text>
        <Text style={styles.laneMeta}>
          {take ? `${(take.durationMs / 1000).toFixed(1)}s` : '—'}
          {take && pauses.length > 0 ? ` · ${pauses.length} pause${pauses.length > 1 ? 's' : ''}` : ''}
        </Text>
      </View>
      <View style={styles.laneBar}>
        {take ? (
          bars.map((h, i) => {
            const t = ((i + 0.5) / BARS) * dur;
            const inPause = pauses.some(p => t >= p.startMs && t <= p.endMs);
            return (
              <View
                key={i}
                style={{
                  flex: 1,
                  marginHorizontal: 0.6,
                  height: Math.max(2, h * 24),
                  borderRadius: 2,
                  backgroundColor: inPause ? colors.danger : color,
                  opacity: inPause ? 0.55 : 0.35 + 0.65 * h,
                }}
              />
            );
          })
        ) : (
          <Text style={styles.laneEmpty}>No earlier take for this verse yet</Text>
        )}
        {take && progressMs !== null && (
          <View style={[styles.lanePlayhead, { left: `${Math.min(100, (progressMs / dur) * 100)}%` }]} />
        )}
      </View>
    </Pressable>
  );
};

export const ReciteCorrect: React.FC<ReciteCorrectProps> = ({
  surahNumber,
  verse,
  verseData,
  previousVerseData,
  words,
  wordTimings,
  onStageChange,
  controlRef,
}) => {
  const [stage, setStage] = useState<ReciteStage>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(-160);
  const [takes, setTakes] = useState<Take[]>([]);
  const [current, setCurrent] = useState<Take | null>(null);
  const [marks, setMarks] = useState<WordMark[]>([]);
  const [pendingWord, setPendingWord] = useState<number | null>(null);
  const [playing, setPlaying] = useState<'current' | 'previous' | null>(null);
  const [progressMs, setProgressMs] = useState<number | null>(null);
  const [weak, setWeak] = useState<WeakWord[]>([]);
  const [saved, setSaved] = useState(false);
  const [micError, setMicError] = useState(false);
  const [peekingWord, setPeekingWord] = useState<number | null>(null);

  // Tarteel-style live word tracker state
  const expectations = useMemo(() => buildWordExpectations(words, wordTimings), [words, wordTimings]);
  const [trackerState, setTrackerState] = useState<LiveReciteTrackerState>(createInitialTrackerState);
  const trackerRef = useRef<LiveReciteTrackerState>(createInitialTrackerState());

  const recorderRef = useRef<RecorderHandle | null>(null);
  const speechSubRef = useRef<Subscription | null>(null);
  const webSpeechRef = useRef<any>(null);

  const previous = useMemo(() => takes.find(t => t.id !== current?.id) ?? null, [takes, current]);

  const refresh = useCallback(async () => {
    setTakes(await getTakesForVerse(surahNumber, verse));
    setWeak(await getWeakWords(surahNumber, verse));
  }, [surahNumber, verse]);

  useEffect(() => {
    let mounted = true;
    Promise.resolve().then(() => {
      if (mounted) refresh();
    });
    return () => {
      mounted = false;
    };
  }, [refresh]);

  useEffect(() => {
    onStageChange?.(stage);
  }, [stage, onStageChange]);

  const stopLiveSpeech = useCallback(() => {
    if (speechSubRef.current) {
      speechSubRef.current.remove();
      speechSubRef.current = null;
    }
    if (isNativePitchDetectorAvailable) {
      stopNativeSpeechRecognizer().catch(() => {});
    }
    if (webSpeechRef.current) {
      try {
        webSpeechRef.current.onresult = null;
        webSpeechRef.current.onend = null;
        webSpeechRef.current.stop();
      } catch {}
      webSpeechRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      stopTakePlayback();
      stopLiveSpeech();
      recorderRef.current?.cancel();
    },
    [stopLiveSpeech]
  );

  // Start Web Speech API or Native SFSpeechRecognizer alongside microphone recording
  const startLiveSpeech = useCallback(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.lang = 'ar-SA';
          rec.continuous = true;
          rec.interimResults = true;
          rec.onresult = (event: any) => {
            let fullTranscript = '';
            for (let i = 0; i < event.results.length; i++) {
              fullTranscript += ' ' + event.results[i][0].transcript;
            }
            const next = mergeTranscriptIntoTracker(trackerRef.current, expectations, fullTranscript);
            if (next.revealedCount > trackerRef.current.revealedCount) {
              Haptics.selectionAsync().catch(() => {});
            }
            trackerRef.current = next;
            setTrackerState(next);
          };
          rec.start();
          webSpeechRef.current = rec;
        } catch {}
      }
      return;
    }

    if (isNativePitchDetectorAvailable) {
      speechSubRef.current = addNativeSpeechListener(ev => {
        if (!ev.transcript) return;
        const next = mergeTranscriptIntoTracker(trackerRef.current, expectations, ev.transcript);
        if (next.revealedCount > trackerRef.current.revealedCount) {
          Haptics.selectionAsync().catch(() => {});
        }
        trackerRef.current = next;
        setTrackerState(next);
      });
      startNativeSpeechRecognizer('ar-SA').catch(() => {});
    }
  }, [expectations]);

  const startRecording = useCallback(async () => {
    setMicError(false);
    setSaved(false);
    const initial = createInitialTrackerState();
    trackerRef.current = initial;
    setTrackerState(initial);

    const handle = await startTakeRecording(surahNumber, verse, (db, ms) => {
      setLevel(db);
      setElapsedMs(ms);

      // Step the live Tarteel-style word cadence & hesitation detector every 100 ms
      const prev = trackerRef.current;
      const next = stepAcousticTracker(prev, expectations, db, ENVELOPE_STEP_MS);
      if (next.revealedCount > prev.revealedCount) {
        Haptics.selectionAsync().catch(() => {});
      }
      trackerRef.current = next;
      setTrackerState(next);
    });
    if (!handle) {
      setMicError(true);
      return;
    }
    recorderRef.current = handle;
    setElapsedMs(0);
    setStage('recording');
    startLiveSpeech();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [surahNumber, verse, expectations, startLiveSpeech]);

  const stopRecording = useCallback(async () => {
    stopLiveSpeech();
    const h = recorderRef.current;
    recorderRef.current = null;
    if (!h) return;
    const take = await h.stop();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (take) {
      // Automatically compute & persist mistakes on behalf of the user!
      const finalized = finalizeTakeAutoMarks(trackerRef.current, expectations, take.envelope, ENVELOPE_STEP_MS);
      const autoMarks: WordMark[] = finalized.marks.map(m => ({ wordIndex: m.wordIndex, reason: m.reason }));
      await updateTakeMarks(take.id, autoMarks);
      const updatedTake: Take = { ...take, marks: autoMarks };
      setCurrent(updatedTake);
      setMarks(autoMarks);
      setSaved(true);
      await refresh();
      setStage('review');
    } else {
      setStage('idle');
    }
  }, [stopLiveSpeech, expectations, refresh]);

  const play = useCallback(
    async (which: 'current' | 'previous') => {
      const take = which === 'current' ? current : previous;
      if (!take) return;
      setPlaying(which);
      setProgressMs(0);
      await playTake(take, setProgressMs);
      setPlaying(null);
      setProgressMs(null);
    },
    [current, previous]
  );

  const playAB = useCallback(async () => {
    if (!previous || !current) return play('current');
    await play('previous');
    await new Promise(r => setTimeout(r, 500));
    await play('current');
  }, [previous, current, play]);

  const primary = useCallback(() => {
    if (stage === 'idle') startRecording();
    else if (stage === 'recording') stopRecording();
    else if (playing)
      stopTakePlayback().then(() => {
        setPlaying(null);
        setProgressMs(null);
      });
    else play('current');
  }, [stage, playing, startRecording, stopRecording, play]);

  useEffect(() => {
    if (controlRef) controlRef.current = { primary, playAB, stage };
  }, [controlRef, primary, playAB, stage]);

  // Auto-save whenever user adjusts a mark in review mode
  const toggleMark = useCallback(
    async (wordIndex: number, reason: SlipReason) => {
      let nextMarks: WordMark[] = [];
      setMarks(prev => {
        const exists = prev.find(m => m.wordIndex === wordIndex);
        if (exists && exists.reason === reason) {
          nextMarks = prev.filter(m => m.wordIndex !== wordIndex);
        } else {
          nextMarks = [...prev.filter(m => m.wordIndex !== wordIndex), { wordIndex, reason }];
        }
        return nextMarks;
      });
      setPendingWord(null);
      if (current) {
        await updateTakeMarks(current.id, nextMarks);
        await refresh();
        setSaved(true);
      }
    },
    [current, refresh]
  );

  const recordAgain = useCallback(() => {
    stopTakePlayback();
    setStage('idle');
    setCurrent(null);
    setMarks([]);
    setPendingWord(null);
    const initial = createInitialTrackerState();
    trackerRef.current = initial;
    setTrackerState(initial);
  }, []);

  const weakByWord = useMemo(() => {
    const m = new Map<number, WeakWord>();
    for (const w of weak) m.set(w.wordIndex, w);
    return m;
  }, [weak]);

  // Previous ayah context cue (either verse - 1, or Bismillah on Ayah 1)
  const showPreviousCue = Boolean(previousVerseData || (verse === 1 && surahNumber !== 9));
  const previousCueLabel = previousVerseData ? `PREVIOUS · AYAH ${verse - 1}` : 'OPENING CUE · BISMILLAH';
  const previousCueArabic = previousVerseData
    ? `${previousVerseData.arabicText} ﴿${toArabicIndic(verse - 1)}﴾`
    : BISMILLAH_CUE;

  // ------------------------------------------------------------------ IDLE / RECORDING (Tarteel Live Fill Mode)
  if (stage !== 'review') {
    const meter = Math.max(0, Math.min(1, (level + 55) / 50));
    const revealedCount = trackerState.revealedCount;
    const liveMarks = trackerState.marks;

    return (
      <ScrollView
        style={styles.wrap}
        contentContainerStyle={styles.liveScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Previous Ayah Lead-In Card so the user knows where to start */}
        {showPreviousCue && (
          <View style={styles.prevCueCard}>
            <View style={styles.prevCueHeader}>
              <View style={styles.prevCueBadge}>
                <Ionicons name="return-down-back" size={12} color={colors.sapphire} />
                <Text style={styles.prevCueBadgeText}>{previousCueLabel}</Text>
              </View>
              {previousVerseData?.englishText ? (
                <Text style={styles.prevCueEnglish} numberOfLines={1}>
                  {previousVerseData.englishText}
                </Text>
              ) : null}
            </View>
            <Text style={styles.prevCueArabic} numberOfLines={2}>
              {previousCueArabic}
            </Text>
          </View>
        )}

        {/* 2. Tarteel-Style Live Word-by-Word Reveal Card */}
        <View style={[styles.liveVerseCard, stage === 'recording' && styles.liveVerseCardRecording]}>
          {/* Top Status Pill + Word Progress Counter */}
          <View style={styles.cardTop}>
            <View style={pill(stage === 'recording' ? 'gold' : 'neutral').container}>
              <Ionicons
                name={stage === 'recording' ? 'radio-button-on' : 'mic-outline'}
                size={11}
                color={stage === 'recording' ? colors.danger : colors.gold}
              />
              <Text style={pill(stage === 'recording' ? 'gold' : 'neutral').text}>
                {stage === 'recording'
                  ? `LIVE ${Math.floor(elapsedMs / 1000 / 60)}:${String(Math.floor((elapsedMs / 1000) % 60)).padStart(2, '0')} · ${revealedCount}/${words.length} words`
                  : `Recite Ayah ${verse}`}
              </Text>
            </View>

            {stage === 'recording' ? (
              <View style={styles.miniMeterRow}>
                {Array.from({ length: 14 }).map((_, i) => {
                  const on = i / 14 < meter;
                  return (
                    <View
                      key={i}
                      style={[
                        styles.miniMeterBar,
                        {
                          height: 5 + (i % 4) * 3,
                          opacity: on ? 1 : 0.2,
                          backgroundColor: on && i > 11 ? colors.danger : colors.gold,
                        },
                      ]}
                    />
                  );
                })}
              </View>
            ) : takes.length > 0 ? (
              <Text style={styles.meta}>
                {takes.length} earlier take{takes.length > 1 ? 's' : ''}
              </Text>
            ) : (
              <Text style={styles.meta}>{words.length} words</Text>
            )}
          </View>

          {/* Word-by-Word Tarteel Grid (RTL) */}
          <View style={styles.tarteelWordsWrap}>
            {words.map((word, index) => {
              const isRevealed = stage === 'recording' && index < revealedCount;
              const isActive = stage === 'recording' && index === revealedCount;
              const isPeeking = peekingWord === index;
              const liveMark = liveMarks.find(m => m.wordIndex === index);
              const weakHere = weakByWord.get(index);

              if (isRevealed || isPeeking) {
                return (
                  <Pressable
                    key={`${index}_${word}`}
                    onPressIn={() => setPeekingWord(index)}
                    onPressOut={() => setPeekingWord(null)}
                    style={[
                      styles.wordChipRevealed,
                      liveMark && {
                        backgroundColor: 'rgba(248, 113, 113, 0.16)',
                        borderColor: REASON_COLOR[liveMark.reason],
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.wordTextRevealed,
                        liveMark && { color: REASON_COLOR[liveMark.reason] },
                      ]}
                    >
                      {word}
                    </Text>
                    {liveMark && (
                      <View
                        style={[
                          styles.liveSlipDot,
                          { backgroundColor: REASON_COLOR[liveMark.reason] },
                        ]}
                      />
                    )}
                  </Pressable>
                );
              }

              // Unspoken word slot (masked Tarteel pill that pulses gold on the active word)
              const pillWidth = Math.max(46, Math.min(115, word.length * 9));
              return (
                <Pressable
                  key={`${index}_${word}`}
                  onPressIn={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setPeekingWord(index);
                  }}
                  onPressOut={() => setPeekingWord(null)}
                  style={[
                    styles.wordPlaceholderPill,
                    { width: pillWidth },
                    isActive && styles.wordPlaceholderActive,
                    weakHere && !isActive && styles.wordPlaceholderWeak,
                    liveMark && {
                      borderColor: REASON_COLOR[liveMark.reason],
                      backgroundColor: 'rgba(248, 113, 113, 0.14)',
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.wordPlaceholderBar,
                      isActive && styles.wordPlaceholderBarActive,
                      liveMark && { backgroundColor: REASON_COLOR[liveMark.reason] },
                    ]}
                  />
                </Pressable>
              );
            })}

            {/* Ayah End Marker */}
            <View
              style={[
                styles.ayahBadgeChip,
                revealedCount >= words.length && styles.ayahBadgeChipComplete,
              ]}
            >
              <Text style={styles.ayahBadgeText}>﴿{toArabicIndic(verse)}﴾</Text>
            </View>
          </View>

          {/* Live Auto-Detected Slips Banner or Instructions */}
          <View style={styles.liveFooter}>
            {micError ? (
              <Text style={[styles.hint, { color: colors.danger }]}>
                Microphone unavailable — allow access in Settings.
              </Text>
            ) : stage === 'recording' ? (
              liveMarks.length > 0 ? (
                <View style={styles.liveSlipsRow}>
                  <Ionicons name="sparkles" size={12} color={colors.gold} />
                  <Text style={styles.liveSlipsText}>
                    Auto-marked {liveMarks.length} slip{liveMarks.length > 1 ? 's' : ''} · Tap ■ when finished
                  </Text>
                </View>
              ) : (
                <Text style={styles.hint}>
                  Recite aloud — each word fills in as you speak. Hold any slot to peek.
                </Text>
              )
            ) : (
              <Text style={styles.hint}>
                Tap the gold mic below and start from Ayah {verse}. Words reveal as you recite and slips are marked automatically.
              </Text>
            )}
          </View>
        </View>
      </ScrollView>
    );
  }

  // ------------------------------------------------------------------ REVIEW STAGE (Auto-Marked Slips + Past Take Compare)
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: space.sm }} showsVerticalScrollIndicator={false}>
      {/* Previous Ayah Context Strip */}
      {showPreviousCue && (
        <View style={styles.prevCueCardCompact}>
          <Text style={styles.prevCueBadgeText}>{previousCueLabel}</Text>
          <Text style={styles.prevCueArabicCompact} numberOfLines={1}>
            {previousCueArabic}
          </Text>
        </View>
      )}

      {/* Auto-Evaluated Verse Card */}
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={pill(marks.length === 0 ? 'mint' : 'gold').container}>
            <Ionicons
              name={marks.length === 0 ? 'checkmark-circle' : 'sparkles'}
              size={12}
              color={marks.length === 0 ? colors.mint : colors.gold}
            />
            <Text style={pill(marks.length === 0 ? 'mint' : 'gold').text}>
              {marks.length === 0
                ? 'Clean recitation · 0 slips'
                : `Auto-marked ${marks.length} slip${marks.length > 1 ? 's' : ''}`}
            </Text>
          </View>
          <Text style={styles.meta}>Tap any word to adjust</Text>
        </View>

        <Text style={styles.arabic}>
          {words.map((w, i) => {
            const mark = marks.find(m => m.wordIndex === i);
            const weakHere = weakByWord.get(i);
            const isPending = pendingWord === i;
            return (
              <Text
                key={`${i}_${w}`}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setPendingWord(isPending ? null : i);
                }}
                style={[
                  styles.word,
                  weakHere && !mark && styles.wordWeak,
                  mark && {
                    backgroundColor: 'rgba(248,113,113,.18)',
                    color: REASON_COLOR[mark.reason],
                    borderRadius: 6,
                  },
                  isPending && styles.wordPending,
                ]}
              >
                {w}
                {i < words.length - 1 ? ' ' : ''}
              </Text>
            );
          })}
          <Text style={styles.ayahEndMark}> ﴿{toArabicIndic(verse)}﴾</Text>
        </Text>
        {verseData?.englishText ? <Text style={styles.translation}>{verseData.englishText}</Text> : null}

        {pendingWord !== null && (
          <View style={styles.reasonRow}>
            <Text style={styles.reasonLabel}>{words[pendingWord]}</Text>
            {REASONS.map(r => {
              const active = marks.some(m => m.wordIndex === pendingWord && m.reason === r);
              return (
                <TouchableOpacity key={r} style={[styles.reasonChip, active && styles.reasonChipOn]} onPress={() => toggleMark(pendingWord, r)}>
                  <Text style={[styles.reasonChipText, active && { color: REASON_COLOR[r] }]}>{SLIP_REASON_LABEL[r]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {marks.length > 0 && (
          <View style={styles.markList}>
            {marks
              .slice()
              .sort((a, b) => a.wordIndex - b.wordIndex)
              .map(m => (
                <TouchableOpacity
                  key={m.wordIndex}
                  onPress={() => toggleMark(m.wordIndex, m.reason)}
                  style={[
                    pill('neutral').container,
                    { borderColor: REASON_COLOR[m.reason] },
                  ]}
                >
                  <Text style={[pill('neutral').text, { color: REASON_COLOR[m.reason] }]}>
                    {words[m.wordIndex]} · {SLIP_REASON_LABEL[m.reason]} ×
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        )}

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.actionBtn, styles.actionGhost]} onPress={recordAgain}>
            <Ionicons name="mic-outline" size={15} color={colors.textBody} />
            <Text style={styles.actionGhostText}>Recite again</Text>
          </TouchableOpacity>
          <View style={[styles.actionBtn, styles.actionSavedBadge]}>
            <Ionicons name="checkmark-circle" size={15} color={colors.mint} />
            <Text style={styles.actionSavedText}>
              {saved ? 'Auto-saved to progress' : 'Saved'}
            </Text>
          </View>
        </View>
      </View>

      {/* Compare against your past recitation take */}
      <View style={[styles.card, styles.cardGold]}>
        <View style={styles.cardTop}>
          <View style={pill('gold').container}>
            <Ionicons name="swap-horizontal" size={11} color={colors.gold} />
            <Text style={pill('gold').text}>Compare with your past take</Text>
          </View>
          <Text style={styles.meta}>Take #{takes.length}</Text>
        </View>

        <Lane label="THIS TAKE" take={current} tone="gold" progressMs={playing === 'current' ? progressMs : null} onPress={() => play('current')} />
        <Lane label="PREVIOUS TAKE" take={previous} tone="sapphire" progressMs={playing === 'previous' ? progressMs : null} onPress={() => play('previous')} />

        <View style={styles.playRow}>
          <TouchableOpacity style={[styles.playChip, playing === 'current' && styles.playChipOn]} onPress={() => play('current')}>
            <Ionicons name={playing === 'current' ? 'pause' : 'play'} size={12} color={colors.gold} />
            <Text style={[styles.playChipText, { color: colors.gold }]}>This</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.playChip, !previous && { opacity: 0.4 }]} disabled={!previous} onPress={playAB}>
            <Ionicons name="repeat" size={12} color={colors.textBody} />
            <Text style={styles.playChipText}>A · B</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.playChip, playing === 'previous' && styles.playChipOn, !previous && { opacity: 0.4 }]} disabled={!previous} onPress={() => play('previous')}>
            <Ionicons name={playing === 'previous' ? 'pause' : 'play'} size={12} color={colors.sapphire} />
            <Text style={[styles.playChipText, { color: colors.sapphire }]}>Previous</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Weak words history for this verse */}
      {weak.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Weak spots · verse {verse}</Text>
          {weak.slice(0, 5).map(w => (
            <View key={w.wordIndex} style={styles.weakRow}>
              <Text style={styles.weakWord}>{words[w.wordIndex] ?? `word ${w.wordIndex + 1}`}</Text>
              <Text style={styles.weakMeta}>
                {Object.entries(w.reasons)
                  .map(([r, n]) => `${SLIP_REASON_LABEL[r as SlipReason]} ×${n}`)
                  .join(' · ')}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 20 },
  liveScrollContent: { flexGrow: 1, paddingBottom: 8 },

  // 1. Previous Ayah Context Cue Card
  prevCueCard: {
    backgroundColor: '#0e1422',
    borderWidth: 1,
    borderColor: '#1e2b45',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
  },
  prevCueCardCompact: {
    backgroundColor: '#0e1422',
    borderWidth: 1,
    borderColor: '#1e2b45',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  prevCueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  prevCueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  prevCueBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: colors.sapphire,
  },
  prevCueEnglish: {
    flex: 1,
    fontSize: 11,
    color: colors.textFaint,
    fontStyle: 'italic',
    textAlign: 'right',
  },
  prevCueArabic: {
    fontFamily: 'UthmanicHafs',
    fontSize: 20,
    lineHeight: 36,
    color: 'rgba(226, 232, 240, 0.78)',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  prevCueArabicCompact: {
    flex: 1,
    fontFamily: 'UthmanicHafs',
    fontSize: 17,
    color: 'rgba(226, 232, 240, 0.75)',
    textAlign: 'right',
    writingDirection: 'rtl',
  },

  // 2. Tarteel-Style Live Word-by-Word Card
  liveVerseCard: {
    flex: 1,
    backgroundColor: '#121726',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1e283d',
    paddingHorizontal: 16,
    paddingVertical: 14,
    justifyContent: 'space-between',
  },
  liveVerseCardRecording: {
    borderColor: colors.goldDeep,
  },
  tarteelWordsWrap: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 10,
  },
  wordChipRevealed: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 11,
    backgroundColor: 'rgba(229, 184, 105, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(229, 184, 105, 0.28)',
    position: 'relative',
  },
  wordTextRevealed: {
    fontFamily: 'UthmanicHafs',
    fontSize: 24,
    lineHeight: 40,
    color: '#ffffff',
    textAlign: 'center',
  },
  liveSlipDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  wordPlaceholderPill: {
    height: 34,
    borderRadius: 10,
    backgroundColor: '#161f33',
    borderWidth: 1,
    borderColor: '#23314f',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  wordPlaceholderActive: {
    borderColor: colors.gold,
    backgroundColor: 'rgba(229, 184, 105, 0.14)',
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
  },
  wordPlaceholderWeak: {
    borderStyle: 'dashed',
    borderColor: colors.goldDeep,
  },
  wordPlaceholderBar: {
    width: '68%',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#283859',
  },
  wordPlaceholderBarActive: {
    backgroundColor: colors.gold,
  },
  ayahBadgeChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#151e30',
    borderWidth: 1,
    borderColor: '#243454',
  },
  ayahBadgeChipComplete: {
    borderColor: colors.mint,
    backgroundColor: 'rgba(52, 211, 153, 0.14)',
  },
  ayahBadgeText: {
    fontFamily: 'UthmanicHafs',
    fontSize: 20,
    color: colors.sapphire,
  },
  miniMeterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
    height: 18,
  },
  miniMeterBar: {
    width: 3,
    borderRadius: 1.5,
  },
  liveFooter: {
    borderTopWidth: 1,
    borderTopColor: '#1c263b',
    paddingTop: 10,
    alignItems: 'center',
  },
  liveSlipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveSlipsText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.gold,
  },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.control + 2,
    padding: space.md,
    marginBottom: space.sm,
  },
  cardGold: { borderColor: colors.goldDeep },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  meta: { ...type.caption },
  hint: { ...type.bodyMuted, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },

  lane: { marginTop: space.sm },
  laneHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  laneLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.8 },
  laneMeta: { ...type.caption },
  laneBar: {
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  laneEmpty: { ...type.caption, flex: 1, textAlign: 'center' },
  lanePlayhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.text },
  playRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  playChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
  },
  playChipOn: { borderColor: colors.goldDeep, backgroundColor: colors.goldTint },
  playChipText: { ...type.body, fontSize: 12.5, fontWeight: '700' },

  sectionLabel: { ...type.label, marginBottom: space.sm },
  arabic: {
    fontFamily: 'UthmanicHafs',
    fontSize: 26,
    lineHeight: 52,
    color: colors.text,
    textAlign: 'center',
    writingDirection: 'rtl',
    marginTop: space.xs,
  },
  word: { color: colors.text },
  wordWeak: { textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: colors.gold },
  wordPending: { backgroundColor: colors.goldTint, color: colors.gold, borderRadius: 6 },
  ayahEndMark: { fontFamily: 'UthmanicHafs', fontSize: 20, color: colors.sapphire },
  translation: { ...type.bodyMuted, fontStyle: 'italic', textAlign: 'center', marginTop: space.xs },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md, flexWrap: 'wrap' },
  reasonLabel: { fontFamily: 'UthmanicHafs', fontSize: 18, color: colors.gold, marginRight: 4 },
  reasonChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
  },
  reasonChipOn: { borderColor: 'rgba(248,113,113,.5)', backgroundColor: 'rgba(248,113,113,.12)' },
  reasonChipText: { ...type.body, fontSize: 12, fontWeight: '700' },
  markList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: radius.control },
  actionGhost: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceRaised },
  actionGhostText: { ...type.body, fontSize: 13, fontWeight: '700' },
  actionSavedBadge: {
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.35)',
    backgroundColor: 'rgba(52, 211, 153, 0.10)',
  },
  actionSavedText: { fontSize: 12.5, fontWeight: '700', color: colors.mint },
  weakRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  weakWord: { fontFamily: 'UthmanicHafs', fontSize: 20, color: colors.text },
  weakMeta: { ...type.caption },
});
