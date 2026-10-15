import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LadderStep, formatVerseRange } from '../services/hifzLadderService';
import { BouncyTouchable } from './BouncyTouchable';

export type LadderPhase = 'listen' | 'recite' | 'preview' | 'complete';

interface HifzLadderHudProps {
  plan: LadderStep[];
  stepIndex: number;
  repsDone: number;
  phase: LadderPhase;
  reciteRemainingSec: number | null;
  reciteTiming: 'auto' | 'tap';
  isTimerPaused: boolean;
  onCompleteRep: () => void;
  onHearAgain: () => void;
  onToggleTimer: () => void;
  onRestartLadder: () => void;
  onExit: () => void;
}

const GOLD = '#e5b869';
const BLUE = '#9bbfff';
const MINT = '#34d399';

export const HifzLadderHud: React.FC<HifzLadderHudProps> = ({
  plan,
  stepIndex,
  repsDone,
  phase,
  reciteRemainingSec,
  reciteTiming,
  isTimerPaused,
  onCompleteRep,
  onHearAgain,
  onToggleTimer,
  onRestartLadder,
  onExit,
}) => {
  const step = plan[Math.min(stepIndex, plan.length - 1)];
  const isRecite = phase === 'recite';
  const isPreview = phase === 'preview';
  const isComplete = phase === 'complete';
  const left = step ? Math.max(0, step.reps - repsDone) : 0;

  // Compress long plans into at most 40 ticks so the bar always fits
  const ticks = useMemo(() => {
    const maxTicks = 40;
    if (plan.length <= maxTicks) return plan.map(s => ({ s, start: s.index, end: s.index }));
    const per = plan.length / maxTicks;
    const out: { s: LadderStep; start: number; end: number }[] = [];
    for (let i = 0; i < maxTicks; i++) {
      const start = Math.floor(i * per);
      const end = Math.min(plan.length - 1, Math.floor((i + 1) * per) - 1);
      out.push({ s: plan[start], start, end });
    }
    return out;
  }, [plan]);

  if (!step) return null;

  const nextStep = plan[stepIndex + 1];
  const accent = isRecite || isPreview ? GOLD : BLUE;

  return (
    <View style={[styles.card, (isRecite || isPreview) && styles.cardRecite, isComplete && styles.cardComplete]}>
      {/* Row 1: step pill + phase pill */}
      <View style={styles.topRow}>
        <View style={styles.pill}>
          <Ionicons name="layers-outline" size={11} color={BLUE} />
          <Text style={styles.pillText}>
            {isComplete ? 'LADDER COMPLETE' : `STEP ${stepIndex + 1} / ${plan.length}`}
          </Text>
        </View>
        {!isComplete && (
          <View style={[styles.pill, { borderColor: accent + '66', backgroundColor: accent + '1f' }]}>
            <Ionicons
              name={isRecite ? 'mic' : isPreview ? 'volume-medium' : 'headset'}
              size={11}
              color={accent}
            />
            <Text style={[styles.pillText, { color: accent }]}>
              {isRecite ? 'Your turn' : isPreview ? 'Hearing again' : 'Listen'} • {formatVerseRange(step)}
            </Text>
          </View>
        )}
        <TouchableOpacity style={styles.exitBtn} onPress={onExit} hitSlop={8}>
          <Ionicons name="close" size={14} color="#7e8ca3" />
        </TouchableOpacity>
      </View>

      {/* Row 2: big counter */}
      {isComplete ? (
        <View style={styles.completeWrap}>
          <Ionicons name="checkmark-circle" size={34} color={MINT} />
          <Text style={styles.completeTitle}>Passage climbed</Text>
          <Text style={styles.completeSub}>
            {plan[0].fromVerse === plan[plan.length - 1].toVerse
              ? `Verse ${plan[0].fromVerse}`
              : `Verses ${plan[0].fromVerse}–${plan[plan.length - 1].toVerse}`}{' '}
            • {plan.length} steps
          </Text>
          <BouncyTouchable style={styles.restartBtn} onPress={onRestartLadder}>
            <Ionicons name="refresh" size={14} color="#080b11" style={{ marginRight: 6 }} />
            <Text style={styles.restartText}>CLIMB AGAIN</Text>
          </BouncyTouchable>
        </View>
      ) : (
        <View style={styles.counterRow}>
          <View style={styles.counterLeft}>
            <Text style={[styles.counterBig, { color: isRecite ? GOLD : '#ffffff' }]}>
              {left}
              <Text style={styles.counterOf}> / {step.reps}</Text>
            </Text>
            <Text style={styles.counterLabel}>
              {isRecite ? 'RECITATIONS LEFT' : isPreview ? 'THEN BACK TO RECITING' : 'LISTENS LEFT'}
            </Text>
          </View>

          {isRecite && (
            <View style={styles.reciteControls}>
              <TouchableOpacity
                style={styles.smallBtn}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  onHearAgain();
                }}
              >
                <Ionicons name="volume-medium-outline" size={18} color="#c9d3e7" />
                <Text style={styles.smallBtnText}>Hear it</Text>
              </TouchableOpacity>
              {reciteTiming === 'auto' && (
                <TouchableOpacity
                  style={styles.smallBtn}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    onToggleTimer();
                  }}
                >
                  <Ionicons name={isTimerPaused ? 'play-outline' : 'pause-outline'} size={18} color="#c9d3e7" />
                  <Text style={styles.smallBtnText}>
                    {reciteRemainingSec !== null ? `0:${String(reciteRemainingSec).padStart(2, '0')}` : '—'}
                  </Text>
                </TouchableOpacity>
              )}
              <BouncyTouchable style={styles.doneBtn} onPress={onCompleteRep}>
                <Ionicons name="checkmark" size={22} color="#080b11" />
              </BouncyTouchable>
            </View>
          )}
        </View>
      )}

      {/* Row 3: ladder progress */}
      <View style={styles.bar}>
        {ticks.map((t, i) => {
          const done = t.end < stepIndex || isComplete;
          const active = !isComplete && stepIndex >= t.start && stepIndex <= t.end;
          const recite = t.s.kind === 'recite';
          return (
            <View
              key={i}
              style={[
                styles.tick,
                recite ? styles.tickRecite : styles.tickListen,
                t.s.isCombined && styles.tickCombined,
                done && (recite ? styles.tickReciteDone : styles.tickListenDone),
                active && { backgroundColor: accent, shadowColor: accent },
                active && styles.tickActive,
              ]}
            />
          );
        })}
      </View>
      {!isComplete && (
        <View style={styles.legendRow}>
          <Text style={styles.legendText}>
            {isRecite
              ? reciteTiming === 'auto'
                ? 'Text hidden • hold card to peek • ✓ when done'
                : 'Text hidden • hold card to peek • tap ✓ after each'
              : 'Word highlighting on • sit back and absorb'}
          </Text>
          {nextStep && (
            <Text style={styles.legendText}>
              next: {nextStep.kind === 'listen' ? 'listen' : 'recite'}{' '}
              {nextStep.fromVerse === nextStep.toVerse
                ? `v${nextStep.fromVerse}`
                : `v${nextStep.fromVerse}–${nextStep.toVerse}`}{' '}
              ×{nextStep.reps}
            </Text>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#121726',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1e283d',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 9,
    marginHorizontal: 20,
    marginBottom: 8,
  },
  cardRecite: { borderColor: '#6b5424', backgroundColor: '#171a24' },
  cardComplete: { borderColor: 'rgba(52, 211, 153, 0.45)' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#162136',
    borderWidth: 1,
    borderColor: '#263859',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  pillText: { color: BLUE, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },
  exitBtn: {
    marginLeft: 'auto',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0f1522',
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  counterLeft: {},
  counterBig: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, lineHeight: 36 },
  counterOf: { fontSize: 16, color: '#7e8ca3', fontWeight: '700' },
  counterLabel: { color: '#7e8ca3', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  reciteControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151d2d',
    borderWidth: 1,
    borderColor: '#24324b',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 58,
  },
  smallBtnText: { color: '#c9d3e7', fontSize: 10.5, fontWeight: '700', marginTop: 1 },
  doneBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  completeWrap: { alignItems: 'center', paddingVertical: 10, gap: 4 },
  completeTitle: { color: '#ffffff', fontWeight: '800', fontSize: 17 },
  completeSub: { color: '#8a95aa', fontSize: 12.5 },
  restartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: MINT,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 8,
  },
  restartText: { color: '#080b11', fontWeight: '800', fontSize: 12.5, letterSpacing: 0.8 },
  bar: { flexDirection: 'row', gap: 3, marginTop: 10 },
  tick: { flex: 1, height: 6, borderRadius: 3 },
  tickListen: { backgroundColor: '#1a2540' },
  tickRecite: { backgroundColor: '#2a2210' },
  tickCombined: { borderWidth: 1, borderColor: '#2a3b5f' },
  tickListenDone: { backgroundColor: '#2d446e' },
  tickReciteDone: { backgroundColor: '#6b5424' },
  tickActive: { shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6, elevation: 3 },
  legendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, gap: 8 },
  legendText: { color: '#6f7d96', fontSize: 10.5, fontWeight: '600', flexShrink: 1 },
});
