import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Surah, Reciter } from '../types';
import { BouncyTouchable } from './BouncyTouchable';
import {
  LadderConfig,
  LadderProgress,
  LADDER_PRESETS,
  DEFAULT_LADDER_CONFIG,
  buildLadderPlan,
  estimatePlanDurationMs,
  getLastLadderConfig,
  getLadderProgress,
  saveLastLadderConfig,
} from '../services/hifzLadderService';

interface HifzLadderSetupModalProps {
  visible: boolean;
  surah: Surah;
  fromVerse: number;
  toVerse: number;
  reciter: Reciter;
  onClose: () => void;
  onStart: (config: LadderConfig, resumeFrom: LadderProgress | null) => void;
}

const Stepper: React.FC<{ value: number; min: number; max: number; onChange: (v: number) => void }> = ({
  value,
  min,
  max,
  onChange,
}) => (
  <View style={styles.stepper}>
    <TouchableOpacity
      style={styles.stepperBtn}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onChange(Math.max(min, value - 1));
      }}
    >
      <Ionicons name="remove" size={16} color="#9bbfff" />
    </TouchableOpacity>
    <Text style={styles.stepperValue}>{value}</Text>
    <TouchableOpacity
      style={styles.stepperBtn}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onChange(Math.min(max, value + 1));
      }}
    >
      <Ionicons name="add" size={16} color="#9bbfff" />
    </TouchableOpacity>
  </View>
);

const Segment: React.FC<{
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}> = ({ options, value, onChange }) => (
  <View style={styles.segment}>
    {options.map(o => (
      <TouchableOpacity
        key={o.key}
        style={[styles.segmentBtn, value === o.key && styles.segmentBtnActive]}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onChange(o.key);
        }}
      >
        <Text style={[styles.segmentText, value === o.key && styles.segmentTextActive]}>{o.label}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

export const HifzLadderSetupModal: React.FC<HifzLadderSetupModalProps> = ({
  visible,
  surah,
  fromVerse,
  toVerse,
  reciter,
  onClose,
  onStart,
}) => {
  const [config, setConfig] = useState<LadderConfig>(DEFAULT_LADDER_CONFIG);
  const [savedProgress, setSavedProgress] = useState<LadderProgress | null>(null);

  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    getLastLadderConfig().then(c => {
      if (mounted && c) setConfig(c);
    });
    getLadderProgress(surah.number, fromVerse, toVerse).then(p => {
      if (mounted) setSavedProgress(p && !p.completed ? p : null);
    });
    return () => {
      mounted = false;
    };
  }, [visible, surah.number, fromVerse, toVerse]);

  const plan = useMemo(() => buildLadderPlan(fromVerse, toVerse, config), [fromVerse, toVerse, config]);
  const estMinutes = Math.max(1, Math.round(estimatePlanDurationMs(plan, {}, 6000) / 60000));
  const verseCount = Math.abs(toVerse - fromVerse) + 1;

  const activePresetId =
    LADDER_PRESETS.find(
      p =>
        p.config.listenNew === config.listenNew &&
        p.config.reciteNew === config.reciteNew &&
        p.config.listenCombined === config.listenCombined &&
        p.config.reciteCombined === config.reciteCombined
    )?.id ?? 'custom';

  const update = (patch: Partial<LadderConfig>) => setConfig(prev => ({ ...prev, ...patch }));

  const start = (resume: LadderProgress | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const cfg = resume ? resume.config : config;
    saveLastLadderConfig(cfg);
    onStart(cfg, resume);
  };

  const resumePlan = savedProgress ? buildLadderPlan(fromVerse, toVerse, savedProgress.config) : [];

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Hifz Ladder</Text>
            <Text style={styles.headerSubtitle}>
              {surah.englishName} • Verses {fromVerse}–{toVerse} • {reciter.shortName}
            </Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={22} color="#ffffff" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {savedProgress && (
            <View style={[styles.card, styles.resumeCard]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.resumeTitle}>Continue where you left off</Text>
                <Text style={styles.resumeDetail}>
                  Step {savedProgress.stepIndex + 1} of {resumePlan.length} •{' '}
                  {savedProgress.config.listenNew}·{savedProgress.config.reciteNew}·
                  {savedProgress.config.listenCombined}·{savedProgress.config.reciteCombined}
                </Text>
              </View>
              <BouncyTouchable style={styles.resumeBtn} onPress={() => start(savedProgress)}>
                <Ionicons name="play" size={14} color="#080b11" style={{ marginRight: 5 }} />
                <Text style={styles.resumeBtnText}>RESUME</Text>
              </BouncyTouchable>
            </View>
          )}

          <Text style={styles.sectionLabel}>PRESETS</Text>
          <View style={styles.presetRow}>
            {LADDER_PRESETS.map(p => (
              <TouchableOpacity
                key={p.id}
                style={[styles.presetChip, activePresetId === p.id && styles.presetChipActive]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  update(p.config);
                }}
              >
                <Text style={[styles.presetLabel, activePresetId === p.id && styles.presetLabelActive]}>{p.label}</Text>
                <Text style={styles.presetDetail}>{p.detail}</Text>
              </TouchableOpacity>
            ))}
            <View style={[styles.presetChip, activePresetId === 'custom' && styles.presetChipActive]}>
              <Text style={[styles.presetLabel, activePresetId === 'custom' && styles.presetLabelActive]}>Custom</Text>
              <Text style={styles.presetDetail}>
                {config.listenNew}·{config.reciteNew}·{config.listenCombined}·{config.reciteCombined}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>EACH NEW VERSE</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowLabelWrap}>
                <Ionicons name="headset-outline" size={15} color="#9bbfff" />
                <Text style={styles.rowLabel}>Listen</Text>
              </View>
              <Stepper value={config.listenNew} min={1} max={30} onChange={v => update({ listenNew: v })} />
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <View style={styles.rowLabelWrap}>
                <Ionicons name="mic-outline" size={15} color="#e5b869" />
                <Text style={styles.rowLabel}>Recite alone</Text>
              </View>
              <Stepper value={config.reciteNew} min={0} max={10} onChange={v => update({ reciteNew: v })} />
            </View>
          </View>

          <Text style={styles.sectionLabel}>COMBINED PASSAGE</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowLabelWrap}>
                <Ionicons name="headset-outline" size={15} color="#9bbfff" />
                <Text style={styles.rowLabel}>Listen</Text>
              </View>
              <Stepper value={config.listenCombined} min={1} max={20} onChange={v => update({ listenCombined: v })} />
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <View style={styles.rowLabelWrap}>
                <Ionicons name="mic-outline" size={15} color="#e5b869" />
                <Text style={styles.rowLabel}>Recite alone</Text>
              </View>
              <Stepper value={config.reciteCombined} min={0} max={10} onChange={v => update({ reciteCombined: v })} />
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Combine style</Text>
              <Segment
                options={[
                  { key: 'cumulative', label: 'Cumulative' },
                  { key: 'chunked', label: 'Chunked' },
                ]}
                value={config.combineStyle}
                onChange={k => update({ combineStyle: k as LadderConfig['combineStyle'] })}
              />
            </View>
            <Text style={styles.hint}>
              {config.combineStyle === 'cumulative'
                ? 'Review 1–2, then 1–3, then 1–4… after every new verse.'
                : 'Review in pairs and fours, then the whole passage at the end.'}
            </Text>
          </View>

          <Text style={styles.sectionLabel}>RECITING</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Advance</Text>
              <Segment
                options={[
                  { key: 'auto', label: 'Auto timer' },
                  { key: 'tap', label: 'Tap ✓ when done' },
                ]}
                value={config.reciteTiming}
                onChange={k => update({ reciteTiming: k as LadderConfig['reciteTiming'] })}
              />
            </View>
            <Text style={styles.hint}>
              {config.reciteTiming === 'auto'
                ? 'Each recitation gets 1.3× the reciter’s time. Tap ✓ to finish early.'
                : 'Take as long as you need; tap ✓ after each recitation.'}
            </Text>
            <View style={styles.divider} />
            <Text style={styles.hint}>
              Verse text is hidden while you recite (hold the card to peek). Double-tap to hear the verse once.
            </Text>
          </View>

          <Text style={styles.sectionLabel}>PLAN PREVIEW</Text>
          <View style={styles.card}>
            <Text style={styles.previewHeadline}>
              {plan.length} steps • ≈ {estMinutes} min • {verseCount} verse{verseCount === 1 ? '' : 's'}
            </Text>
            <View style={styles.previewBar}>
              {plan.slice(0, 60).map(s => (
                <View
                  key={s.index}
                  style={[
                    styles.previewTick,
                    s.kind === 'listen' ? styles.previewTickListen : styles.previewTickRecite,
                    s.isCombined && styles.previewTickCombined,
                  ]}
                />
              ))}
            </View>
            <View style={styles.previewLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.previewTickListen]} />
                <Text style={styles.legendText}>Listen</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.previewTickRecite]} />
                <Text style={styles.legendText}>Recite</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.previewTickListen, styles.previewTickCombined]} />
                <Text style={styles.legendText}>Combined</Text>
              </View>
            </View>
          </View>

          <BouncyTouchable style={styles.startBtn} onPress={() => start(null)}>
            <Ionicons name="play" size={20} color="#080b11" style={{ marginRight: 10 }} />
            <Text style={styles.startText}>{savedProgress ? 'START OVER' : 'START LADDER'}</Text>
          </BouncyTouchable>
          <Text style={styles.footnote}>Progress is saved per surah so you can resume later.</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#080b11' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerTitle: { color: '#ffffff', fontSize: 24, fontWeight: '800' },
  headerSubtitle: { color: '#8a95aa', fontSize: 12.5, marginTop: 2 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#151d2d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  sectionLabel: {
    color: '#7e8ca3',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 18,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#121726',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1e283d',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  resumeCard: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderColor: '#6b5424',
    backgroundColor: '#1a160c',
  },
  resumeTitle: { color: '#e5b869', fontWeight: '800', fontSize: 14 },
  resumeDetail: { color: '#b8a77a', fontSize: 12, marginTop: 2 },
  resumeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e5b869',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  resumeBtnText: { color: '#080b11', fontWeight: '800', fontSize: 12.5, letterSpacing: 0.8 },
  presetRow: { flexDirection: 'row', gap: 8 },
  presetChip: {
    flex: 1,
    backgroundColor: '#121726',
    borderWidth: 1,
    borderColor: '#1e283d',
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  presetChipActive: { borderColor: '#9bbfff', backgroundColor: '#162136' },
  presetLabel: { color: '#aab6cc', fontWeight: '700', fontSize: 13 },
  presetLabelActive: { color: '#9bbfff' },
  presetDetail: { color: '#7e8ca3', fontSize: 11, marginTop: 2, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    gap: 10,
  },
  rowLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { color: '#e6ecf7', fontSize: 14.5, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#1a2540' },
  hint: { color: '#8a95aa', fontSize: 12, lineHeight: 17, paddingBottom: 10 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0f1a',
    borderWidth: 1,
    borderColor: '#1c273d',
    borderRadius: 11,
    padding: 3,
  },
  stepperBtn: { width: 32, height: 30, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { color: '#ffffff', fontWeight: '800', fontSize: 16, minWidth: 30, textAlign: 'center' },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#0a0f1a',
    borderWidth: 1,
    borderColor: '#1c273d',
    borderRadius: 10,
    padding: 2.5,
  },
  segmentBtn: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 8 },
  segmentBtnActive: { backgroundColor: '#1a2842', borderWidth: 1, borderColor: '#2d446e' },
  segmentText: { color: '#7e8ca3', fontSize: 12, fontWeight: '700' },
  segmentTextActive: { color: '#9bbfff' },
  previewHeadline: { color: '#e6ecf7', fontWeight: '700', fontSize: 13.5, paddingTop: 8 },
  previewBar: { flexDirection: 'row', gap: 3, marginTop: 10, flexWrap: 'wrap' },
  previewTick: { width: 10, height: 7, borderRadius: 2 },
  previewTickListen: { backgroundColor: '#2d446e' },
  previewTickRecite: { backgroundColor: '#6b5424' },
  previewTickCombined: { opacity: 1, borderWidth: 1, borderColor: '#9bbfff' },
  previewLegend: { flexDirection: 'row', gap: 14, marginTop: 10, paddingBottom: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 7, borderRadius: 2 },
  legendText: { color: '#8a95aa', fontSize: 11, fontWeight: '600' },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9bbfff',
    paddingVertical: 17,
    borderRadius: 16,
    marginTop: 22,
    shadowColor: '#9bbfff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  startText: { color: '#080b11', fontSize: 16, fontWeight: '800', letterSpacing: 1.3 },
  footnote: { color: '#52627a', fontSize: 11.5, textAlign: 'center', marginTop: 10 },
});
