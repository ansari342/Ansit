import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Verse } from '../types';
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
import { colors, space, radius, type, pill, shadow } from '../theme';

export type ReciteStage = 'idle' | 'recording' | 'review';

interface ReciteCorrectProps {
  surahNumber: number;
  verse: number;
  verseData?: Verse;
  words: string[];
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

export const ReciteCorrect: React.FC<ReciteCorrectProps> = ({ surahNumber, verse, verseData, words, onStageChange, controlRef }) => {
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
  const recorderRef = useRef<RecorderHandle | null>(null);

  const previous = useMemo(() => takes.find(t => t.id !== current?.id) ?? null, [takes, current]);

  const refresh = useCallback(async () => {
    setTakes(await getTakesForVerse(surahNumber, verse));
    setWeak(await getWeakWords(surahNumber, verse));
  }, [surahNumber, verse]);

  // The parent remounts this component per verse (key), so history just loads once (async)
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

  useEffect(
    () => () => {
      stopTakePlayback();
      recorderRef.current?.cancel();
    },
    []
  );

  const startRecording = useCallback(async () => {
    setMicError(false);
    setSaved(false);
    const handle = await startTakeRecording(surahNumber, verse, (db, ms) => {
      setLevel(db);
      setElapsedMs(ms);
    });
    if (!handle) {
      setMicError(true);
      return;
    }
    recorderRef.current = handle;
    setElapsedMs(0);
    setStage('recording');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [surahNumber, verse]);

  const stopRecording = useCallback(async () => {
    const h = recorderRef.current;
    recorderRef.current = null;
    if (!h) return;
    const take = await h.stop();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (take) {
      setCurrent(take);
      setMarks([]);
      await refresh();
      setStage('review');
    } else {
      setStage('idle');
    }
  }, [refresh]);

  const play = useCallback(async (which: 'current' | 'previous') => {
    const take = which === 'current' ? current : previous;
    if (!take) return;
    setPlaying(which);
    setProgressMs(0);
    await playTake(take, setProgressMs);
    setPlaying(null);
    setProgressMs(null);
  }, [current, previous]);

  const playAB = useCallback(async () => {
    if (!previous || !current) return play('current');
    await play('previous');
    await new Promise(r => setTimeout(r, 500));
    await play('current');
  }, [previous, current, play]);

  const primary = useCallback(() => {
    if (stage === 'idle') startRecording();
    else if (stage === 'recording') stopRecording();
    else if (playing) stopTakePlayback().then(() => { setPlaying(null); setProgressMs(null); });
    else play('current');
  }, [stage, playing, startRecording, stopRecording, play]);

  useEffect(() => {
    if (controlRef) controlRef.current = { primary, playAB, stage };
  }, [controlRef, primary, playAB, stage]);

  const toggleMark = useCallback(
    (wordIndex: number, reason: SlipReason) => {
      setSaved(false);
      setMarks(prev => {
        const exists = prev.find(m => m.wordIndex === wordIndex);
        if (exists && exists.reason === reason) return prev.filter(m => m.wordIndex !== wordIndex);
        return [...prev.filter(m => m.wordIndex !== wordIndex), { wordIndex, reason }];
      });
      setPendingWord(null);
    },
    []
  );

  const save = useCallback(async () => {
    if (!current) return;
    await updateTakeMarks(current.id, marks);
    await refresh();
    setSaved(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [current, marks, refresh]);

  const recordAgain = useCallback(() => {
    stopTakePlayback();
    setStage('idle');
    setCurrent(null);
    setMarks([]);
    setPendingWord(null);
  }, []);

  const weakByWord = useMemo(() => {
    const m = new Map<number, WeakWord>();
    for (const w of weak) m.set(w.wordIndex, w);
    return m;
  }, [weak]);

  // ------------------------------------------------------------------ render
  if (stage !== 'review') {
    const meter = Math.max(0, Math.min(1, (level + 55) / 50));
    return (
      <View style={styles.wrap}>
        <View style={[styles.card, stage === 'recording' && styles.cardRecording]}>
          <View style={styles.cardTop}>
            <View style={pill(stage === 'recording' ? 'gold' : 'neutral').container}>
              <Ionicons name={stage === 'recording' ? 'radio-button-on' : 'mic-outline'} size={11} color={stage === 'recording' ? colors.danger : colors.textMuted} />
              <Text style={pill(stage === 'recording' ? 'gold' : 'neutral').text}>
                {stage === 'recording' ? `REC ${Math.floor(elapsedMs / 1000 / 60)}:${String(Math.floor((elapsedMs / 1000) % 60)).padStart(2, '0')}` : 'Recite & correct'}
              </Text>
            </View>
            {takes.length > 0 && <Text style={styles.meta}>{takes.length} earlier take{takes.length > 1 ? 's' : ''}</Text>}
          </View>

          {stage === 'recording' ? (
            <View style={styles.meterRow}>
              {Array.from({ length: 28 }).map((_, i) => {
                const on = i / 28 < meter;
                return <View key={i} style={[styles.meterBar, { height: 6 + (i % 5) * 4, opacity: on ? 1 : 0.18, backgroundColor: on && i > 22 ? colors.danger : colors.gold }]} />;
              })}
            </View>
          ) : (
            <Text style={styles.hint}>
              {micError
                ? 'Microphone unavailable — allow access in Settings.'
                : 'Verse text is hidden. Tap ● below, recite from memory, then tap ■ to review and mark any slips.'}
            </Text>
          )}
        </View>

        <View style={styles.hiddenBox}>
          <View style={styles.hiddenLines}>
            {[0.9, 0.7, 0.8].map((w, i) => (
              <View key={i} style={[styles.hiddenLine, { width: `${w * 100}%` }]} />
            ))}
          </View>
          <Ionicons name="eye-off-outline" size={22} color={colors.goldDeep} style={{ marginTop: space.xl }} />
          <Text style={styles.hiddenTitle}>{stage === 'recording' ? 'Recording your recitation' : 'Recite from memory'}</Text>
          <Text style={styles.hiddenHint}>{stage === 'recording' ? 'Tap ■ when you finish' : `Verse ${verse}`}</Text>
          {weak.length > 0 && stage === 'idle' && (
            <View style={[pill('gold').container, { marginTop: space.md }]}>
              <Ionicons name="alert-circle-outline" size={11} color={colors.gold} />
              <Text style={pill('gold').text}>{weak.length} weak word{weak.length > 1 ? 's' : ''} in this verse</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: space.sm }} showsVerticalScrollIndicator={false}>
      {/* Compare card */}
      <View style={[styles.card, styles.cardGold]}>
        <View style={styles.cardTop}>
          <View style={pill('gold').container}>
            <Ionicons name="swap-horizontal" size={11} color={colors.gold} />
            <Text style={pill('gold').text}>Compare · take {takes.length}</Text>
          </View>
          <View style={pill(marks.length === 0 ? 'mint' : 'neutral').container}>
            <Text style={pill(marks.length === 0 ? 'mint' : 'neutral').text}>
              {marks.length === 0 ? 'No slips marked' : `${marks.length} slip${marks.length > 1 ? 's' : ''}`}
            </Text>
          </View>
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

      {/* Verse with tap-to-mark */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Tap a word you slipped on</Text>
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
                  mark && styles.wordMarked,
                  isPending && styles.wordPending,
                ]}
              >
                {w}
                {i < words.length - 1 ? ' ' : ''}
              </Text>
            );
          })}
        </Text>
        {verseData?.englishText ? <Text style={styles.translation}>{verseData.englishText}</Text> : null}

        {pendingWord !== null && (
          <View style={styles.reasonRow}>
            <Text style={styles.reasonLabel}>{words[pendingWord]}</Text>
            {REASONS.map(r => {
              const active = marks.some(m => m.wordIndex === pendingWord && m.reason === r);
              return (
                <TouchableOpacity key={r} style={[styles.reasonChip, active && styles.reasonChipOn]} onPress={() => toggleMark(pendingWord, r)}>
                  <Text style={[styles.reasonChipText, active && { color: colors.danger }]}>{SLIP_REASON_LABEL[r]}</Text>
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
                <View key={m.wordIndex} style={[pill('neutral').container, { borderColor: 'rgba(248,113,113,.4)' }]}>
                  <Text style={[pill('neutral').text, { color: colors.danger }]}>{words[m.wordIndex]} · {SLIP_REASON_LABEL[m.reason]}</Text>
                </View>
              ))}
          </View>
        )}

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.actionBtn, styles.actionGhost]} onPress={recordAgain}>
            <Ionicons name="mic-outline" size={15} color={colors.textBody} />
            <Text style={styles.actionGhostText}>Record again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, saved ? styles.actionSaved : styles.actionPrimary]} onPress={save}>
            <Ionicons name={saved ? 'checkmark-circle' : 'save-outline'} size={15} color={colors.bg} />
            <Text style={styles.actionPrimaryText}>{saved ? 'Saved' : marks.length === 0 ? 'Save as clean' : `Save ${marks.length} slip${marks.length > 1 ? 's' : ''}`}</Text>
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
  wrap: { flex: 1, paddingHorizontal: space.xl },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.control + 2,
    padding: space.md,
    marginBottom: space.sm,
  },
  cardGold: { borderColor: colors.goldDeep },
  cardRecording: { borderColor: 'rgba(248,113,113,.45)' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  meta: { ...type.caption },
  hint: { ...type.bodyMuted, marginTop: space.sm, lineHeight: 18 },
  meterRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 30, marginTop: space.sm },
  meterBar: { flex: 1, borderRadius: 2 },

  hiddenBox: {
    flex: 1,
    minHeight: 180,
    borderRadius: radius.surface,
    borderWidth: 1,
    borderColor: colors.goldDeep,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.xxl,
  },
  hiddenLines: { width: '70%', gap: 14, alignItems: 'flex-end', opacity: 0.35 },
  hiddenLine: { height: 14, borderRadius: 7, backgroundColor: colors.sapphireDeep },
  hiddenTitle: { ...type.heading, color: colors.gold, marginTop: space.xs },
  hiddenHint: { ...type.caption, color: colors.textMuted, marginTop: 2 },

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
  arabic: { fontFamily: 'UthmanicHafs', fontSize: 27, lineHeight: 56, color: colors.text, textAlign: 'center', writingDirection: 'rtl' },
  word: { color: colors.text },
  wordWeak: { textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: colors.gold },
  wordMarked: { backgroundColor: 'rgba(248,113,113,.18)', color: '#ffd4d4', borderRadius: 6 },
  wordPending: { backgroundColor: colors.goldTint, color: colors.gold, borderRadius: 6 },
  translation: { ...type.bodyMuted, fontStyle: 'italic', textAlign: 'center', marginTop: space.sm },
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
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: radius.control },
  actionGhost: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceRaised },
  actionGhostText: { ...type.body, fontSize: 13, fontWeight: '700' },
  actionPrimary: { backgroundColor: colors.gold, ...shadow.glow(colors.gold) },
  actionSaved: { backgroundColor: colors.mint },
  actionPrimaryText: { fontSize: 13, fontWeight: '800', color: colors.bg },
  weakRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  weakWord: { fontFamily: 'UthmanicHafs', fontSize: 20, color: colors.text },
  weakMeta: { ...type.caption },
});
