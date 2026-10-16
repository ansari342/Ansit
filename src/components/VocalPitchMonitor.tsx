import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  LayoutChangeEvent,
  GestureResponderEvent,
} from 'react-native';
import Svg, { Path, Line, Rect, Circle, Text as SvgText, Defs, ClipPath, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Reciter } from '../types';
import { WordTiming } from '../data/reciterTimings';
import {
  VersePitchTrack,
  MicPitchSample,
  MicPitchTracker,
  getVersePitchTrack,
  extractVersePitchTrackAsync,
  sampleTrackAtMs,
  midiToNoteName,
} from '../services/pitchService';
import { setAudioVolume } from '../services/audioService';

export type PitchPracticeMode = 'listen' | 'imitate';

interface VocalPitchMonitorProps {
  surahNumber: number;
  ayahNumber: number;
  words: string[];
  wordTimings: WordTiming[];
  reciter: Reciter;
  positionMillis: number;
  durationMillis: number;
  ayahStartMs?: number;
  ayahEndMs?: number;
  totalTrackDurationMs?: number;
  isPlaying: boolean;
  echoPass: 1 | 2;
  mode: PitchPracticeMode;
  onChangeMode: (mode: PitchPracticeMode) => void;
  onSeekFraction?: (fraction: number) => void;
}

interface TracePoint {
  atMs: number;
  midi: number;
  isOnPitch: boolean;
}

const CANVAS_HEIGHT = 184;
const LABEL_GUTTER = 30;
const SAPPHIRE = '#9bbfff';
const AMBER = '#fbbf24';
const MINT = '#34d399';

/** Builds SVG path data for a pitch contour, breaking the stroke across unvoiced gaps. */
function buildContourPath(
  midi: number[],
  frameToX: (frameIndex: number) => number,
  midiToY: (midi: number) => number
): string {
  let d = '';
  let penDown = false;
  for (let i = 0; i < midi.length; i++) {
    const m = midi[i];
    if (m <= 0) {
      penDown = false;
      continue;
    }
    const x = frameToX(i).toFixed(1);
    const y = midiToY(m).toFixed(1);
    d += penDown ? ` L${x} ${y}` : ` M${x} ${y}`;
    penDown = true;
  }
  return d;
}

export const VocalPitchMonitor: React.FC<VocalPitchMonitorProps> = ({
  surahNumber,
  ayahNumber,
  reciter,
  positionMillis,
  durationMillis,
  ayahStartMs = 0,
  ayahEndMs = 0,
  totalTrackDurationMs = 0,
  isPlaying,
  echoPass,
  mode,
  onChangeMode,
  onSeekFraction,
}) => {
  const [canvasWidth, setCanvasWidth] = useState(320);
  const [guideVolume, setGuideVolume] = useState<'20%' | 'Muted' | '50%'>('20%');
  const [keyMode, setKeyMode] = useState<'auto' | 'exact'>('auto');
  const keyModeRef = useRef<'auto' | 'exact'>('auto');
  useEffect(() => {
    keyModeRef.current = keyMode;
    trackerRef.current?.reset();
  }, [keyMode]);
  const [micState, setMicState] = useState<'off' | 'starting' | 'live' | 'denied' | 'unsupported'>('off');
  const [liveTrack, setLiveTrack] = useState<VersePitchTrack | null>(null);
  const [isMapping, setIsMapping] = useState(false);
  const [trace, setTrace] = useState<TracePoint[]>([]);
  const [latest, setLatest] = useState<MicPitchSample | null>(null);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [livePosMs, setLivePosMs] = useState(positionMillis);

  const trackerRef = useRef<MicPitchTracker | null>(null);
  const posAnchorRef = useRef({ pos: positionMillis, at: Date.now() });
  const livePosRef = useRef(positionMillis);
  const scoreAccRef = useRef({ hits: 0, total: 0 });

  const isMicTurn = mode === 'imitate';

  // ---- Time window of this ayah (absolute recording ms) ----
  const windowStartMs = ayahStartMs;
  const windowEndMs = ayahEndMs > ayahStartMs ? ayahEndMs : ayahStartMs + Math.max(1000, durationMillis);
  const windowDurMs = Math.max(1, windowEndMs - windowStartMs);

  // ---- Reciter pitch track: shipped HD map → coarse map → on-demand (web) ----
  const shippedTrack = useMemo(
    () => getVersePitchTrack(reciter, surahNumber, ayahNumber, windowStartMs, windowEndMs),
    [reciter, surahNumber, ayahNumber, windowStartMs, windowEndMs]
  );

  useEffect(() => {
    let cancelled = false;
    setLiveTrack(null);
    if (shippedTrack && shippedTrack.source === 'hd') {
      setIsMapping(false);
      return;
    }
    setIsMapping(true);
    extractVersePitchTrackAsync(reciter, surahNumber, ayahNumber, windowStartMs, windowEndMs, totalTrackDurationMs)
      .then(t => {
        if (!cancelled) {
          if (t) setLiveTrack(t);
          setIsMapping(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsMapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shippedTrack, reciter, surahNumber, ayahNumber, windowStartMs, windowEndMs, totalTrackDurationMs]);

  const track: VersePitchTrack | null = liveTrack ?? shippedTrack;
  const trackRef = useRef(track);
  trackRef.current = track;

  // ---- Smooth 60 fps playhead interpolated between status ticks ----
  useEffect(() => {
    posAnchorRef.current = { pos: positionMillis, at: Date.now() };
    livePosRef.current = positionMillis;
    setLivePosMs(positionMillis);
  }, [positionMillis]);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const a = posAnchorRef.current;
      const next = Math.min(windowDurMs, a.pos + (Date.now() - a.at));
      livePosRef.current = next;
      setLivePosMs(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, windowDurMs]);

  const playheadAbsMs = windowStartMs + livePosMs;

  // ---- Reset trace when verse / mode changes or the loop wraps ----
  useEffect(() => {
    setTrace([]);
    setLatest(null);
    setMatchScore(null);
    scoreAccRef.current = { hits: 0, total: 0 };
    trackerRef.current?.reset();
  }, [surahNumber, ayahNumber, reciter.id, mode, echoPass]);

  const lastPosForWrapRef = useRef(0);
  useEffect(() => {
    if (positionMillis < lastPosForWrapRef.current - 1500) {
      setTrace([]);
      scoreAccRef.current = { hits: 0, total: 0 };
      setMatchScore(null);
    }
    lastPosForWrapRef.current = positionMillis;
  }, [positionMillis]);

  // ---- Guide audio volume while the microphone is active ----
  useEffect(() => {
    if (!isMicTurn) {
      setAudioVolume(1.0);
      return;
    }
    setAudioVolume(guideVolume === 'Muted' ? 0 : guideVolume === '20%' ? 0.2 : 0.5);
  }, [isMicTurn, guideVolume]);

  useEffect(() => () => {
    setAudioVolume(1.0);
  }, []);

  // ---- Microphone lifecycle ----
  useEffect(() => {
    if (!isMicTurn) {
      if (trackerRef.current) {
        trackerRef.current.stop();
        trackerRef.current = null;
      }
      setMicState('off');
      setLatest(null);
      return;
    }

    if (!MicPitchTracker.isSupported) {
      setMicState('unsupported');
      return;
    }

    let mounted = true;
    const tracker = new MicPitchTracker();
    trackerRef.current = tracker;
    setMicState('starting');

    tracker
      .start(reading => {
        if (!mounted) return;
        const atMs = windowStartMs + livePosRef.current;
        const sample = tracker.compare(reading, trackRef.current, atMs, keyModeRef.current);
        setLatest(sample);
        if (!sample.isVoiced) return;

        setTrace(prev => {
          const trimmed =
            prev.length > 0 && sample.atMs < prev[prev.length - 1].atMs - 1500 ? [] : prev;
          const next = [...trimmed, { atMs: sample.atMs, midi: sample.displayMidi, isOnPitch: sample.isOnPitch }];
          return next.length > 1400 ? next.slice(next.length - 1400) : next;
        });

        if (sample.targetIsVoiced) {
          const acc = scoreAccRef.current;
          acc.total += 1;
          if (sample.isOnPitch) acc.hits += 1;
          if (acc.total % 4 === 0) setMatchScore(Math.round((100 * acc.hits) / acc.total));
        }
      })
      .then(ok => {
        if (!mounted) return;
        setMicState(ok ? 'live' : 'denied');
      });

    return () => {
      mounted = false;
      tracker.stop();
      if (trackerRef.current === tracker) trackerRef.current = null;
    };
  }, [isMicTurn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Geometry ----
  const plotWidth = Math.max(10, canvasWidth - LABEL_GUTTER);
  const minMidi = track?.minMidi ?? 45;
  const maxMidi = track?.maxMidi ?? 60;
  const midiSpan = Math.max(1, maxMidi - minMidi);
  const midiToY = useCallback(
    (m: number) => CANVAS_HEIGHT - ((m - minMidi) / midiSpan) * CANVAS_HEIGHT,
    [minMidi, midiSpan]
  );
  const absMsToX = useCallback(
    (ms: number) => ((ms - windowStartMs) / windowDurMs) * plotWidth,
    [windowStartMs, windowDurMs, plotWidth]
  );

  const reciterPath = useMemo(() => {
    if (!track) return '';
    return buildContourPath(
      track.midi,
      i => absMsToX(track.startMs + (i + 0.5) * track.hopMs),
      midiToY
    );
  }, [track, absMsToX, midiToY]);

  const userPaths = useMemo(() => {
    const on: string[] = [];
    const off: string[] = [];
    let cur = '';
    let curOn: boolean | null = null;
    let prev: TracePoint | null = null;
    const flush = () => {
      if (cur && curOn !== null) (curOn ? on : off).push(cur);
      cur = '';
    };
    for (const p of trace) {
      const x = absMsToX(p.atMs).toFixed(1);
      const y = midiToY(p.midi).toFixed(1);
      const gap = prev ? p.atMs - prev.atMs : 0;
      if (!prev || gap > 220 || gap < 0 || curOn !== p.isOnPitch) {
        flush();
        curOn = p.isOnPitch;
        cur = prev && gap <= 220 && gap >= 0
          ? `M${absMsToX(prev.atMs).toFixed(1)} ${midiToY(prev.midi).toFixed(1)} L${x} ${y}`
          : `M${x} ${y}`;
      } else {
        cur += ` L${x} ${y}`;
      }
      prev = p;
    }
    flush();
    return { on: on.join(' '), off: off.join(' ') };
  }, [trace, absMsToX, midiToY]);

  const gridLines = useMemo(() => {
    const step = midiSpan > 18 ? 3 : midiSpan > 12 ? 2 : 1;
    const lines: { y: number; label: string; strong: boolean }[] = [];
    for (let m = Math.ceil(minMidi); m <= Math.floor(maxMidi); m++) {
      const isC = ((m % 12) + 12) % 12 === 0;
      if ((m - Math.ceil(minMidi)) % step === 0 || isC) {
        lines.push({ y: midiToY(m), label: midiToNoteName(m), strong: isC });
      }
    }
    return lines;
  }, [minMidi, maxMidi, midiSpan, midiToY]);

  const target = track ? sampleTrackAtMs(track, playheadAbsMs) : null;
  const playheadX = Math.max(0, Math.min(plotWidth, absMsToX(playheadAbsMs)));
  const orbMidi = isMicTurn && latest?.isVoiced ? latest.displayMidi : target?.isVoiced ? target.midi : 0;
  const orbY = orbMidi > 0 ? midiToY(orbMidi) : null;

  const noteBadge = isMicTurn && latest?.isVoiced
    ? `${latest.noteName} • ${Math.round(latest.rawFreqHz)} Hz`
    : target?.isVoiced
    ? `${target.noteName} • ${Math.round(target.freqHz)} Hz`
    : '— • pause';

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 20) setCanvasWidth(w);
  }, []);

  const handleCanvasTouch = useCallback(
    (e: GestureResponderEvent) => {
      if (!onSeekFraction || plotWidth <= 0) return;
      const fraction = Math.max(0, Math.min(0.99, e.nativeEvent.locationX / plotWidth));
      onSeekFraction(fraction);
    },
    [onSeekFraction, plotWidth]
  );

  const cycleGuideVolume = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setGuideVolume(v => (v === '20%' ? 'Muted' : v === 'Muted' ? '50%' : '20%'));
  }, []);

  const statusText = (() => {
    if (isMapping && !track) return 'Mapping reciter pitch from recording…';
    if (!track) return 'Pitch map not available for this verse yet';
    if (!isMicTurn) {
      return `${reciter.shortName} voice map • ${track.source === 'hd' ? '10 ms resolution' : 'coarse'}`;
    }
    if (micState === 'starting') return 'Starting microphone…';
    if (micState === 'denied') return 'Microphone access denied — enable it in Settings';
    if (micState === 'unsupported') return 'Microphone pitch tracking unavailable on this device';
    if (latest?.isVoiced) {
      if (!latest.targetIsVoiced) return 'Reciter is pausing here';
      if (latest.isOnPitch) return '● On pitch';
      return latest.centsOffset > 0
        ? `▲ ${Math.abs(latest.centsOffset)}¢ sharp`
        : `▼ ${Math.abs(latest.centsOffset)}¢ flat`;
    }
    return 'Listening… recite along with the blue line';
  })();

  const statusStyle =
    isMicTurn && latest?.isVoiced && latest.targetIsVoiced
      ? latest.isOnPitch
        ? styles.statusOn
        : styles.statusOff
      : micState === 'denied' || micState === 'unsupported'
      ? styles.statusWarn
      : styles.statusIdle;

  return (
    <View style={styles.card}>
      {/* Mode switcher */}
      <View style={styles.topRow}>
        <View style={styles.segment}>
          {(
            [
              ['listen', 'headset-outline', 'Trace'],
              ['imitate', 'mic-outline', 'Imitate'],
            ] as const
          ).map(([key, icon, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.segmentBtn, mode === key && styles.segmentBtnActive]}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onChangeMode(key);
              }}
            >
              <Ionicons name={icon} size={12} color={mode === key ? SAPPHIRE : '#7e8ca3'} />
              <Text style={[styles.segmentText, mode === key && styles.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {isMicTurn && (
          <TouchableOpacity
            style={[styles.pill, keyMode === 'auto' && styles.pillGold]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setKeyMode(k => (k === 'auto' ? 'exact' : 'auto'));
            }}
          >
            <Ionicons name="musical-notes-outline" size={12} color={keyMode === 'auto' ? AMBER : SAPPHIRE} />
            <Text style={[styles.pillText, keyMode === 'auto' && { color: AMBER }]}>
              {keyMode === 'auto' ? (latest && latest.keyOffsetSemitones !== 0 ? `Auto key ${latest.keyOffsetSemitones > 0 ? '+' : ''}${latest.keyOffsetSemitones} st` : 'Auto key') : 'Exact pitch'}
            </Text>
          </TouchableOpacity>
        )}
        {isMicTurn && (
          <TouchableOpacity style={styles.pill} onPress={cycleGuideVolume}>
            <Ionicons
              name={guideVolume === 'Muted' ? 'volume-mute-outline' : 'volume-low-outline'}
              size={12}
              color={SAPPHIRE}
            />
            <Text style={styles.pillText}>Guide {guideVolume}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Telemetry */}
      <View style={styles.telemetryRow}>
        <View style={styles.telemetryLeft}>
          <View style={styles.noteBadge}>
            <Text style={styles.noteBadgeText}>{noteBadge}</Text>
          </View>
          <Text style={[styles.statusText, statusStyle]} numberOfLines={1}>
            {statusText}
          </Text>
        </View>
        <View style={styles.telemetryRight}>
          {matchScore !== null && isMicTurn && (
            <View style={styles.scoreBadge}>
              <Text style={styles.scoreText}>{matchScore}% match</Text>
            </View>
          )}
        </View>
      </View>

      {/* Pitch canvas */}
      <View
        style={styles.canvas}
        onLayout={handleLayout}
        onStartShouldSetResponder={() => true}
        onResponderGrant={handleCanvasTouch}
        onResponderMove={handleCanvasTouch}
      >
        <Svg width={canvasWidth} height={CANVAS_HEIGHT}>
          <Defs>
            <ClipPath id="playedClip">
              <Rect x={0} y={0} width={Math.max(0, playheadX)} height={CANVAS_HEIGHT} />
            </ClipPath>
          </Defs>

          {/* Semitone grid */}
          {gridLines.map((g, i) => (
            <G key={i}>
              <Line
                x1={0}
                x2={plotWidth}
                y1={g.y}
                y2={g.y}
                stroke={g.strong ? '#27395c' : '#1a2540'}
                strokeWidth={g.strong ? 1 : 0.75}
              />
              <SvgText
                x={canvasWidth - 4}
                y={g.y + 3.5}
                fontSize={9.5}
                fontWeight="700"
                fill={g.strong ? '#7f94b8' : '#52627a'}
                textAnchor="end"
              >
                {g.label}
              </SvgText>
            </G>
          ))}

          {/* Reciter voice map (ghost) */}
          {reciterPath !== '' && (
            <Path
              d={reciterPath}
              stroke={SAPPHIRE}
              strokeOpacity={isMicTurn ? 0.55 : 0.32}
              strokeWidth={isMicTurn ? 2 : 2.4}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Played portion in Listen mode */}
          {!isMicTurn && reciterPath !== '' && (
            <Path
              d={reciterPath}
              stroke="#ffffff"
              strokeWidth={2.8}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath="url(#playedClip)"
            />
          )}

          {/* Your voice */}
          {isMicTurn && userPaths.off !== '' && (
            <Path d={userPaths.off} stroke={AMBER} strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {isMicTurn && userPaths.on !== '' && (
            <Path d={userPaths.on} stroke="#ffffff" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}

          {/* Playhead */}
          <Line x1={playheadX} x2={playheadX} y1={0} y2={CANVAS_HEIGHT} stroke={SAPPHIRE} strokeOpacity={0.3} strokeWidth={1} />
          {orbY !== null && (
            <Circle
              cx={playheadX}
              cy={orbY}
              r={5}
              fill="#ffffff"
              stroke={isMicTurn && latest?.isOnPitch ? MINT : SAPPHIRE}
              strokeWidth={2}
            />
          )}
        </Svg>

        <View style={styles.legend} pointerEvents="none">
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: SAPPHIRE }]} />
            <Text style={styles.legendText}>{reciter.shortName}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: '#ffffff' }]} />
            <Text style={styles.legendText}>{isMicTurn ? 'You (on pitch)' : 'Played'}</Text>
          </View>
          {isMicTurn && (
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: AMBER }]} />
              <Text style={styles.legendText}>Off pitch</Text>
            </View>
          )}
        </View>

        {!track && !isMapping && (
          <View style={styles.emptyOverlay} pointerEvents="none">
            <Ionicons name="pulse-outline" size={18} color="#52627a" />
            <Text style={styles.emptyText}>Reciter voice map coming soon for this verse</Text>
          </View>
        )}
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
    flexWrap: 'wrap',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#0a0f1a',
    borderRadius: 11,
    padding: 2.5,
    borderWidth: 1,
    borderColor: '#1c273d',
  },
  segmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: '#1a2842',
    borderWidth: 1,
    borderColor: '#2d446e',
  },
  segmentText: { fontSize: 11.5, fontWeight: '600', color: '#7e8ca3' },
  segmentTextActive: { color: SAPPHIRE, fontWeight: '700' },
  pill: {
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
  pillText: { color: '#c9d3e7', fontSize: 11, fontWeight: '600' },
  pillGold: { borderColor: '#6b5424', backgroundColor: '#272010' },
  telemetryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    minHeight: 24,
    gap: 6,
  },
  telemetryLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, flex: 1 },
  telemetryRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteBadge: {
    backgroundColor: '#162136',
    borderWidth: 1,
    borderColor: '#263859',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 7,
  },
  noteBadgeText: { color: SAPPHIRE, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.2 },
  statusText: { fontSize: 11.5, fontWeight: '600', flexShrink: 1 },
  statusIdle: { color: '#8a95aa', fontWeight: '500' },
  statusOn: { color: MINT, fontWeight: '700' },
  statusOff: { color: AMBER, fontWeight: '700' },
  statusWarn: { color: '#f87171' },
  echoBadge: {
    backgroundColor: '#162238',
    borderWidth: 1,
    borderColor: '#2b426b',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 8,
  },
  echoBadgeMic: { backgroundColor: '#272010', borderColor: '#8c6b28' },
  echoText: { color: SAPPHIRE, fontSize: 11, fontWeight: '700' },
  echoTextMic: { color: '#e5b869' },
  scoreBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.45)',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 8,
  },
  scoreText: { color: MINT, fontSize: 11.5, fontWeight: '800' },
  canvas: {
    height: CANVAS_HEIGHT,
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e2b45',
    backgroundColor: '#0c1220',
    position: 'relative',
  },
  legend: {
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
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { width: 10, height: 2.5, borderRadius: 1 },
  legendText: { color: '#b8c5db', fontSize: 10, fontWeight: '600' },
  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyText: { color: '#52627a', fontSize: 11.5, fontWeight: '600' },
});
