import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  LayoutChangeEvent,
  GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Reciter } from '../types';
import { WordTiming } from '../data/reciterTimings';
import {
  generateVersePitchProfile,
  samplePitchProfileAt,
  MicPitchTracker,
  LiveMicSample,
} from '../services/pitchService';
import { setAudioVolume } from '../services/audioService';

export type PitchPracticeMode = 'listen' | 'imitate' | 'echo';
export type PitchKeyMode = 'relative' | 'exact';

interface VocalPitchMonitorProps {
  surahNumber: number;
  ayahNumber: number;
  words: string[];
  wordTimings: WordTiming[];
  reciter: Reciter;
  positionMillis: number;
  durationMillis: number;
  isPlaying: boolean;
  echoPass: 1 | 2; // 1 = Listen to Reciter, 2 = Your Turn (Mic)
  mode: PitchPracticeMode;
  onChangeMode: (mode: PitchPracticeMode) => void;
  onSeekFraction?: (fraction: number) => void;
}

interface Point2D {
  x: number;
  y: number;
  isOnPitch?: boolean;
}

/**
 * Pure React Native continuous curve renderer using anti-aliased rotated segment views.
 * Zero native SVG binary dependencies required; runs at 60fps.
 */
const ContinuousCurveLine = React.memo<{
  points: Point2D[];
  color: string;
  thickness?: number;
  dashed?: boolean;
  highlightOnPitch?: boolean;
}>(({ points, color, thickness = 2.6, dashed = false, highlightOnPitch = false }) => {
  if (points.length < 2) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {points.map((pt, idx) => {
        if (idx === 0) return null;
        if (dashed && idx % 2 === 1) return null;

        const prev = points[idx - 1];
        const dx = pt.x - prev.x;
        const dy = pt.y - prev.y;
        // Skip large horizontal jumps (e.g., unvoiced silence gaps in mic trace)
        if (dx < 0 || dx > 42) return null;

        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < 0.5) return null;

        const angleRad = Math.atan2(dy, dx);
        const midX = (prev.x + pt.x) / 2;
        const midY = (prev.y + pt.y) / 2;

        const segColor =
          highlightOnPitch && pt.isOnPitch !== undefined
            ? pt.isOnPitch
              ? '#ffffff'
              : '#fbbf24'
            : color;

        return (
          <View
            key={idx}
            style={{
              position: 'absolute',
              left: midX - (length + 1.2) / 2,
              top: midY - thickness / 2,
              width: length + 1.2,
              height: thickness,
              borderRadius: thickness / 2,
              backgroundColor: segColor,
              transform: [{ rotate: `${angleRad}rad` }],
            }}
          />
        );
      })}
    </View>
  );
});

export const VocalPitchMonitor: React.FC<VocalPitchMonitorProps> = ({
  surahNumber,
  ayahNumber,
  words,
  wordTimings,
  reciter,
  positionMillis,
  durationMillis,
  isPlaying,
  echoPass,
  mode,
  onChangeMode,
  onSeekFraction,
}) => {
  const [canvasSize, setCanvasSize] = useState({ width: 320, height: 176 });
  const [keyMode, setKeyMode] = useState<PitchKeyMode>('relative');
  const [guideVolumeLevel, setGuideVolumeLevel] = useState<'20%' | 'Muted' | '50%'>('20%');
  const [micPermissionDenied, setMicPermissionDenied] = useState<boolean>(false);

  // Recorded user pitch trace points for the current verse pass
  const [userTrace, setUserTrace] = useState<LiveMicSample[]>([]);
  const [latestMicSample, setLatestMicSample] = useState<LiveMicSample | null>(null);
  const [matchScore, setMatchScore] = useState<number | null>(null);

  const micTrackerRef = useRef<MicPitchTracker | null>(null);
  const lastProgressRef = useRef<number>(0);
  const progressRatioRef = useRef<number>(0);
  const keyModeRef = useRef<PitchKeyMode>(keyMode);
  keyModeRef.current = keyMode;

  const isMicActiveTurn =
    mode === 'imitate' || (mode === 'echo' && echoPass === 2);

  // 1. Generate Reciter Pitch Profile (Lanes, Quantized Target Note Blocks, 96-pt Ghost Contour)
  const profile = useMemo(
    () =>
      generateVersePitchProfile(
        surahNumber,
        ayahNumber,
        words,
        wordTimings,
        reciter
      ),
    [surahNumber, ayahNumber, words, wordTimings, reciter]
  );

  const profileRef = useRef(profile);
  profileRef.current = profile;

  const progressRatio = useMemo(() => {
    if (!durationMillis || durationMillis <= 1) return 0;
    return Math.max(0, Math.min(1, positionMillis / durationMillis));
  }, [positionMillis, durationMillis]);

  progressRatioRef.current = progressRatio;

  // Clear user mic trace when verse changes, mode changes, or playhead loops back to start
  useEffect(() => {
    if (progressRatio < lastProgressRef.current - 0.25) {
      setUserTrace([]);
    }
    lastProgressRef.current = progressRatio;
  }, [progressRatio]);

  useEffect(() => {
    setUserTrace([]);
    setMatchScore(null);
    setLatestMicSample(null);
    micTrackerRef.current?.resetCalibration();
  }, [surahNumber, ayahNumber, reciter.id, mode, echoPass]);

  // 2. Manage Reciter Guide Audio Volume based on active mode & echo pass
  useEffect(() => {
    if (!isMicActiveTurn) {
      setAudioVolume(1.0);
    } else {
      const vol =
        guideVolumeLevel === 'Muted'
          ? 0.0
          : guideVolumeLevel === '20%'
          ? 0.2
          : 0.5;
      setAudioVolume(vol);
    }
  }, [isMicActiveTurn, guideVolumeLevel]);

  // Restore full volume on unmount
  useEffect(() => {
    return () => {
      setAudioVolume(1.0);
    };
  }, []);

  // 3. Start/Stop Real-Time Microphone Pitch Tracker when in Imitate or Auto-Echo Pass 2
  useEffect(() => {
    let isMounted = true;

    if (isMicActiveTurn) {
      const tracker = new MicPitchTracker();
      micTrackerRef.current = tracker;

      tracker
        .start(rawSample => {
          if (!isMounted) return;
          const t = progressRatioRef.current;
          const mapped = tracker.mapSampleToProfile(
            rawSample,
            profileRef.current,
            t,
            keyModeRef.current
          );
          setLatestMicSample(mapped);

          if (mapped.isVoiced) {
            setUserTrace(prev => {
              // Avoid duplicate points at identical timestamps and cap at 90 points
              const filtered =
                prev.length > 0 && mapped.t < prev[prev.length - 1].t - 0.15
                  ? []
                  : prev.filter(p => Math.abs(p.t - mapped.t) > 0.008);
              const next = [...filtered, mapped];

              // Compute rolling Pitch Match % score (0-100%)
              let totalScore = 0;
              for (const pt of next) {
                const absCents = Math.abs(pt.centsOffset);
                const ptScore = Math.max(0, 100 - Math.max(0, absCents - 18) * 0.75);
                totalScore += ptScore;
              }
              setMatchScore(Math.round(totalScore / next.length));
              return next;
            });
          }
        })
        .then(started => {
          if (isMounted && !started) {
            setMicPermissionDenied(true);
          } else if (isMounted) {
            setMicPermissionDenied(false);
          }
        });

      return () => {
        isMounted = false;
        tracker.stop();
        micTrackerRef.current = null;
      };
    } else {
      if (micTrackerRef.current) {
        micTrackerRef.current.stop();
        micTrackerRef.current = null;
      }
      setLatestMicSample(null);
    }
  }, [isMicActiveTurn]);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 20 && height > 20) {
      setCanvasSize({ width, height });
    }
  }, []);

  const handleCanvasTouch = useCallback(
    (e: GestureResponderEvent) => {
      if (!onSeekFraction || canvasSize.width <= 0) return;
      const x = e.nativeEvent.locationX;
      const fraction = Math.max(0, Math.min(0.99, x / canvasSize.width));
      onSeekFraction(fraction);
    },
    [onSeekFraction, canvasSize.width]
  );

  const toggleKeyMode = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setKeyMode(prev => (prev === 'relative' ? 'exact' : 'relative'));
    micTrackerRef.current?.resetCalibration();
  }, []);

  const cycleGuideVolume = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setGuideVolumeLevel(prev =>
      prev === '20%' ? 'Muted' : prev === 'Muted' ? '50%' : '20%'
    );
  }, []);

  // Sample reciter's target pitch at current playhead
  const currentReciterTarget = useMemo(
    () => samplePitchProfileAt(profile, progressRatio),
    [profile, progressRatio]
  );

  const laneHeight = canvasSize.height / 8;

  // Convert full reciter contour (96 pts) to 2D canvas coordinates
  const ghostContourPoints = useMemo<Point2D[]>(() => {
    const w = canvasSize.width;
    return profile.contourPoints.map(pt => ({
      x: pt.t * w,
      y: (pt.laneFloat + 0.5) * laneHeight,
    }));
  }, [profile.contourPoints, canvasSize.width, laneHeight]);

  // Active white pitch line:
  // - In Listen mode (or Auto-Echo Pass 1): slices ghostContourPoints up to progressRatio
  // - In Imitate mode (or Auto-Echo Pass 2): maps userTrace points
  const activeWhitePoints = useMemo<Point2D[]>(() => {
    const w = canvasSize.width;
    if (!isMicActiveTurn) {
      const count = Math.max(
        2,
        Math.floor(progressRatio * profile.contourPoints.length)
      );
      return ghostContourPoints.slice(0, count);
    } else {
      return userTrace.map(pt => ({
        x: pt.t * w,
        y: (pt.laneFloat + 0.5) * laneHeight,
        isOnPitch: pt.isOnPitch,
      }));
    }
  }, [
    isMicActiveTurn,
    progressRatio,
    profile.contourPoints.length,
    ghostContourPoints,
    userTrace,
    canvasSize.width,
    laneHeight,
  ]);

  // Playhead cursor position
  const playheadX = progressRatio * canvasSize.width;
  const playheadY = useMemo(() => {
    if (isMicActiveTurn && latestMicSample?.isVoiced) {
      return (latestMicSample.laneFloat + 0.5) * laneHeight;
    }
    return (currentReciterTarget.laneFloat + 0.5) * laneHeight;
  }, [isMicActiveTurn, latestMicSample, currentReciterTarget.laneFloat, laneHeight]);

  // Live note badge text
  const activeNoteLabel = useMemo(() => {
    if (isMicActiveTurn && latestMicSample?.isVoiced) {
      return `${latestMicSample.noteName} • ${latestMicSample.rawFreqHz} Hz`;
    }
    return `${currentReciterTarget.noteName} • ${currentReciterTarget.freqHz} Hz`;
  }, [isMicActiveTurn, latestMicSample, currentReciterTarget]);

  return (
    <View style={styles.card}>
      {/* 1. TOP STUDIO HEADER: 3-WAY MODE SWITCHER & KEY/GUIDE CONTROLS */}
      <View style={styles.topRow}>
        <View style={styles.modeSegmentContainer}>
          <TouchableOpacity
            style={[
              styles.modeSegmentBtn,
              mode === 'listen' && styles.modeSegmentBtnActive,
            ]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChangeMode('listen');
            }}
          >
            <Ionicons
              name="headset-outline"
              size={12}
              color={mode === 'listen' ? '#9bbfff' : '#7e8ca3'}
            />
            <Text
              style={[
                styles.modeSegmentText,
                mode === 'listen' && styles.modeSegmentTextActive,
              ]}
            >
              Listen
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeSegmentBtn,
              mode === 'imitate' && styles.modeSegmentBtnActive,
            ]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChangeMode('imitate');
            }}
          >
            <Ionicons
              name="mic-outline"
              size={12}
              color={mode === 'imitate' ? '#9bbfff' : '#7e8ca3'}
            />
            <Text
              style={[
                styles.modeSegmentText,
                mode === 'imitate' && styles.modeSegmentTextActive,
              ]}
            >
              Imitate
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeSegmentBtn,
              mode === 'echo' && styles.modeSegmentBtnActive,
            ]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChangeMode('echo');
            }}
          >
            <Ionicons
              name="repeat-outline"
              size={12}
              color={mode === 'echo' ? '#9bbfff' : '#7e8ca3'}
            />
            <Text
              style={[
                styles.modeSegmentText,
                mode === 'echo' && styles.modeSegmentTextActive,
              ]}
            >
              Auto-Echo
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.rightPillsRow}>
          {isMicActiveTurn && (
            <TouchableOpacity style={styles.smallSettingPill} onPress={cycleGuideVolume}>
              <Ionicons
                name={guideVolumeLevel === 'Muted' ? 'volume-mute-outline' : 'volume-low-outline'}
                size={12}
                color="#9bbfff"
              />
              <Text style={styles.smallSettingText}>{guideVolumeLevel}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.keyPill} onPress={toggleKeyMode}>
            <Text style={styles.keyPillText}>
              {keyMode === 'relative' ? 'Auto-Octave' : 'Exact Hz'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. TELEMETRY STATUS BAR: LIVE NOTE, TUNING STATUS & MATCH % */}
      <View style={styles.telemetryRow}>
        <View style={styles.telemetryLeft}>
          <View style={styles.noteBadge}>
            <Text style={styles.noteBadgeText}>{activeNoteLabel}</Text>
          </View>

          {micPermissionDenied && isMicActiveTurn ? (
            <Text style={styles.warningText}>Enable Mic in Settings</Text>
          ) : isMicActiveTurn ? (
            latestMicSample?.isVoiced ? (
              <Text
                style={[
                  styles.tuningStatusText,
                  latestMicSample.isOnPitch
                    ? styles.tuningOnPitch
                    : styles.tuningOffPitch,
                ]}
              >
                {latestMicSample.isOnPitch
                  ? '● On Pitch'
                  : latestMicSample.centsOffset > 0
                  ? '▲ Slightly High'
                  : '▼ Slightly Low'}
              </Text>
            ) : (
              <Text style={styles.statusIdleText}>Recite into mic to trace pitch...</Text>
            )
          ) : (
            <Text style={styles.statusIdleText}>
              {reciter.shortName} Ghost Pitch
            </Text>
          )}
        </View>

        <View style={styles.telemetryRight}>
          {mode === 'echo' && (
            <View
              style={[
                styles.echoPhaseBadge,
                echoPass === 2 && styles.echoPhaseMicBadge,
              ]}
            >
              <Text
                style={[
                  styles.echoPhaseText,
                  echoPass === 2 && styles.echoPhaseMicText,
                ]}
              >
                {echoPass === 1 ? 'Pass 1: Listen' : 'Pass 2: Your Turn'}
              </Text>
            </View>
          )}

          {matchScore !== null && (mode === 'imitate' || mode === 'echo') && (
            <View style={styles.matchScoreBadge}>
              <Text style={styles.matchScoreText}>{matchScore}% Match</Text>
            </View>
          )}
        </View>
      </View>

      {/* 3. MELODYNE-STYLE VOCAL PITCH CANVAS (MATCHING AYA COLOR SCHEME) */}
      <View
        style={styles.canvasContainer}
        onLayout={handleLayout}
        onStartShouldSetResponder={() => true}
        onResponderGrant={handleCanvasTouch}
        onResponderMove={handleCanvasTouch}
      >
        {/* A. 8 Alternating Semitone Lanes */}
        {profile.lanes.map((lane, idx) => (
          <View
            key={lane.laneIndex}
            style={[
              styles.laneRow,
              {
                height: laneHeight,
                backgroundColor: idx % 2 === 0 ? '#0c1220' : '#11192b',
              },
            ]}
          >
            <Text style={styles.laneNoteLabel}>{lane.noteName}</Text>
          </View>
        ))}

        {/* B. Quantized Target Note Blocks (Gilded Amber/Gold Blocks) */}
        {profile.targetBlocks.map((block, bIdx) => {
          const left = block.startRatio * canvasSize.width;
          const width = Math.max(6, (block.endRatio - block.startRatio) * canvasSize.width);
          const top = block.laneIndex * laneHeight + 1;
          const isCurrentBlock =
            progressRatio >= block.startRatio && progressRatio <= block.endRatio;

          return (
            <View
              key={`block_${bIdx}`}
              pointerEvents="none"
              style={[
                styles.targetNoteBlock,
                isCurrentBlock && styles.targetNoteBlockActive,
                {
                  left,
                  top,
                  width,
                  height: Math.max(6, laneHeight - 2),
                },
              ]}
            />
          );
        })}

        {/* C. Reciter Ghost Pitch Contour (Sapphire Blue #9bbfff Guide Curve) */}
        <ContinuousCurveLine
          points={ghostContourPoints}
          color={
            isMicActiveTurn
              ? 'rgba(155, 191, 255, 0.58)'
              : 'rgba(155, 191, 255, 0.30)'
          }
          thickness={2.2}
          dashed={isMicActiveTurn}
        />

        {/* D. Active Live Pitch Line (Crisp White Line matching screenshot) */}
        <ContinuousCurveLine
          points={activeWhitePoints}
          color="#ffffff"
          thickness={3.0}
          highlightOnPitch={isMicActiveTurn}
        />

        {/* E. Subtle Playhead Vertical Guide Line & Glowing Pitch Orb */}
        <View
          pointerEvents="none"
          style={[
            styles.playheadVerticalLine,
            { left: Math.max(0, Math.min(canvasSize.width - 1, playheadX)) },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.playheadOrb,
            isMicActiveTurn &&
              latestMicSample?.isVoiced &&
              latestMicSample.isOnPitch &&
              styles.playheadOrbMatched,
            {
              left: Math.max(0, Math.min(canvasSize.width - 10, playheadX - 5)),
              top: Math.max(0, Math.min(canvasSize.height - 10, playheadY - 5)),
            },
          ]}
        />

        {/* F. Compact Legend Overlay */}
        <View style={styles.legendOverlay} pointerEvents="none">
          <View style={styles.legendItem}>
            <View style={styles.legendSwatchBlock} />
            <Text style={styles.legendText}>Target Note</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.legendSwatchGhost} />
            <Text style={styles.legendText}>Ghost Contour</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.legendSwatchWhite} />
            <Text style={styles.legendText}>
              {isMicActiveTurn ? 'Your Voice' : 'Reciter Pitch'}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#121726',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1e283d',
    padding: 12,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 6,
  },
  modeSegmentContainer: {
    flexDirection: 'row',
    backgroundColor: '#0a0f1a',
    borderRadius: 11,
    padding: 2.5,
    borderWidth: 1,
    borderColor: '#1c273d',
  },
  modeSegmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  modeSegmentBtnActive: {
    backgroundColor: '#1a2842',
    borderWidth: 1,
    borderColor: '#2d446e',
  },
  modeSegmentText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#7e8ca3',
  },
  modeSegmentTextActive: {
    color: '#9bbfff',
    fontWeight: '700',
  },
  rightPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  smallSettingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#151d2d',
    borderWidth: 1,
    borderColor: '#24324b',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 8,
  },
  smallSettingText: {
    color: '#c9d3e7',
    fontSize: 11,
    fontWeight: '600',
  },
  keyPill: {
    backgroundColor: '#272010',
    borderWidth: 1,
    borderColor: '#6b5424',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  keyPillText: {
    color: '#e5b869',
    fontSize: 11,
    fontWeight: '700',
  },
  telemetryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    minHeight: 24,
  },
  telemetryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  noteBadge: {
    backgroundColor: '#162136',
    borderWidth: 1,
    borderColor: '#263859',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 7,
  },
  noteBadgeText: {
    color: '#9bbfff',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  tuningStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  tuningOnPitch: {
    color: '#34d399',
  },
  tuningOffPitch: {
    color: '#fbbf24',
  },
  statusIdleText: {
    color: '#8a95aa',
    fontSize: 11.5,
    fontWeight: '500',
  },
  warningText: {
    color: '#f87171',
    fontSize: 11.5,
    fontWeight: '600',
  },
  telemetryRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  echoPhaseBadge: {
    backgroundColor: '#162238',
    borderWidth: 1,
    borderColor: '#2b426b',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 8,
  },
  echoPhaseMicBadge: {
    backgroundColor: '#272010',
    borderColor: '#8c6b28',
  },
  echoPhaseText: {
    color: '#9bbfff',
    fontSize: 11,
    fontWeight: '700',
  },
  echoPhaseMicText: {
    color: '#e5b869',
  },
  matchScoreBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.45)',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 8,
  },
  matchScoreText: {
    color: '#34d399',
    fontSize: 11.5,
    fontWeight: '800',
  },
  canvasContainer: {
    height: 172,
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e2b45',
    backgroundColor: '#0c1220',
    position: 'relative',
  },
  laneRow: {
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a253a',
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 8,
  },
  laneNoteLabel: {
    color: '#52627a',
    fontSize: 10,
    fontWeight: '700',
  },
  targetNoteBlock: {
    position: 'absolute',
    backgroundColor: 'rgba(217, 130, 24, 0.72)',
    borderRadius: 3,
    borderWidth: 0.8,
    borderColor: 'rgba(229, 184, 105, 0.55)',
  },
  targetNoteBlockActive: {
    backgroundColor: 'rgba(232, 152, 36, 0.92)',
    borderColor: '#fbbf24',
  },
  playheadVerticalLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(155, 191, 255, 0.28)',
  },
  playheadOrb: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#9bbfff',
    shadowColor: '#9bbfff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
    elevation: 4,
  },
  playheadOrbMatched: {
    borderColor: '#34d399',
    shadowColor: '#34d399',
  },
  legendOverlay: {
    position: 'absolute',
    top: 6,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(8, 11, 17, 0.82)',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#1d2940',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendSwatchBlock: {
    width: 9,
    height: 6,
    borderRadius: 1.5,
    backgroundColor: '#e0891b',
  },
  legendSwatchGhost: {
    width: 10,
    height: 2,
    backgroundColor: '#9bbfff',
  },
  legendSwatchWhite: {
    width: 10,
    height: 2.5,
    backgroundColor: '#ffffff',
  },
  legendText: {
    color: '#b8c5db',
    fontSize: 10,
    fontWeight: '600',
  },
});
