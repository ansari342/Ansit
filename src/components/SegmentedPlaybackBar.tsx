import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  LayoutChangeEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';

interface SegmentedPlaybackBarProps {
  fromVerse: number;
  toVerse: number;
  currentVerseNum: number;
  positionMillis: number;
  durationMillis: number;
  onSeekAyah: (ayahNumber: number, seekFraction?: number) => void;
  onSeekingChange?: (isSeeking: boolean) => void;
}

export const SegmentedPlaybackBar: React.FC<SegmentedPlaybackBarProps> = ({
  fromVerse,
  toVerse,
  currentVerseNum,
  positionMillis,
  durationMillis,
  onSeekAyah,
  onSeekingChange,
}) => {
  const barWidthRef = useRef<number>(320);
  const [barWidth, setBarWidth] = useState<number>(320);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [scrubTargetAyah, setScrubTargetAyah] = useState<number>(currentVerseNum);
  const [scrubFraction, setScrubFraction] = useState<number>(0);
  const [scrubPixelX, setScrubPixelX] = useState<number>(0);

  const lastVibrationAyahRef = useRef<number>(currentVerseNum);
  const totalVerses = Math.max(1, toVerse - fromVerse + 1);

  const getAyahAndFraction = (locationX: number) => {
    const width = Math.max(10, barWidthRef.current);
    const clampedX = Math.max(0, Math.min(width, locationX));
    const globalRatio = clampedX / width;
    const rawVal = globalRatio * totalVerses;
    const segmentIndex = Math.min(totalVerses - 1, Math.floor(rawVal));
    const fractionInAyah = Math.min(1, Math.max(0, rawVal - segmentIndex));
    const targetAyah = fromVerse + segmentIndex;

    return { targetAyah, fractionInAyah, clampedX };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 2 || Math.abs(gestureState.dy) < 8,
      onMoveShouldSetPanResponderCapture: (_, gestureState) =>
        Math.abs(gestureState.dx) > 2,

      onPanResponderGrant: evt => {
        setIsScrubbing(true);
        if (onSeekingChange) onSeekingChange(true);

        const { targetAyah, fractionInAyah, clampedX } = getAyahAndFraction(
          evt.nativeEvent.locationX
        );
        setScrubTargetAyah(targetAyah);
        setScrubFraction(fractionInAyah);
        setScrubPixelX(clampedX);
        lastVibrationAyahRef.current = targetAyah;

        try {
          Haptics.selectionAsync();
        } catch (e) {}
      },

      onPanResponderMove: evt => {
        const { targetAyah, fractionInAyah, clampedX } = getAyahAndFraction(
          evt.nativeEvent.locationX
        );
        setScrubTargetAyah(targetAyah);
        setScrubFraction(fractionInAyah);
        setScrubPixelX(clampedX);

        if (targetAyah !== lastVibrationAyahRef.current) {
          lastVibrationAyahRef.current = targetAyah;
          try {
            Haptics.selectionAsync();
          } catch (e) {}
        }
      },

      onPanResponderRelease: evt => {
        const { targetAyah, fractionInAyah } = getAyahAndFraction(
          evt.nativeEvent.locationX
        );
        setIsScrubbing(false);
        if (onSeekingChange) onSeekingChange(false);

        // Commit seek
        onSeekAyah(targetAyah, fractionInAyah);

        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch (e) {}
      },

      onPanResponderTerminate: () => {
        setIsScrubbing(false);
        if (onSeekingChange) onSeekingChange(false);
      },
    })
  ).current;

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) {
      barWidthRef.current = w;
      setBarWidth(w);
    }
  };

  const formatTime = (millis: number) => {
    const totalSec = Math.floor(millis / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const normalProgress = Math.min(
    1,
    Math.max(0, positionMillis / (durationMillis || 1))
  );

  const displayAyah = isScrubbing ? scrubTargetAyah : currentVerseNum;
  const segments = Array.from({ length: totalVerses }, (_, idx) => fromVerse + idx);

  // Compute handle position on the bar
  const activeSegmentIdx = Math.max(0, Math.min(totalVerses - 1, currentVerseNum - fromVerse));
  const normalRatio = (activeSegmentIdx + normalProgress) / totalVerses;
  const handleX = isScrubbing
    ? scrubPixelX
    : Math.max(0, Math.min(barWidth, normalRatio * barWidth));

  return (
    <View style={styles.container}>
      {/* Tooltip badge while scrubbing */}
      <View style={styles.tooltipRow}>
        {isScrubbing ? (
          <View style={styles.scrubTooltip}>
            <Text style={styles.scrubTooltipText}>Ayah {scrubTargetAyah}</Text>
          </View>
        ) : (
          <View style={{ height: 24 }} />
        )}
      </View>

      {/* Main Bar with Interactive Handle */}
      <View
        style={styles.touchArea}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
      >
        <View style={styles.barRow}>
          {segments.map(ayahNum => {
            let isPast = false;
            let isCurrent = false;
            let fillPercent = 0;

            if (isScrubbing) {
              isPast = ayahNum < scrubTargetAyah;
              isCurrent = ayahNum === scrubTargetAyah;
              fillPercent = isCurrent ? Math.round(scrubFraction * 100) : 0;
            } else {
              isPast = ayahNum < currentVerseNum;
              isCurrent = ayahNum === currentVerseNum;
              fillPercent = isCurrent ? Math.round(normalProgress * 100) : 0;
            }

            return (
              <View
                key={ayahNum}
                style={[
                  styles.segmentTrack,
                  isCurrent && styles.segmentTrackCurrent,
                  totalVerses > 10 ? { marginHorizontal: 1.5 } : { marginHorizontal: 2.5 },
                ]}
              >
                {isPast && <View style={[styles.fill, { width: '100%' }]} />}

                {isCurrent && (
                  <View
                    style={[
                      styles.fill,
                      styles.fillActive,
                      { width: `${fillPercent}%` },
                    ]}
                  />
                )}
              </View>
            );
          })}
        </View>

        {/* PERMANENT VISIBLE SCRUBBER HANDLE / KNOB */}
        <View
          style={[
            styles.scrubberHandle,
            { left: Math.max(0, Math.min(barWidth - 18, handleX - 9)) },
            isScrubbing && styles.scrubberHandleActive,
          ]}
        >
          <View style={styles.scrubberHandleInnerDot} />
        </View>
      </View>

      {/* Timestamps & Ayah Counter */}
      <View style={styles.metaRow}>
        <View style={styles.metaLeft}>
          <Text style={styles.timeText}>{formatTime(positionMillis)}</Text>
          <View style={styles.verseBadge}>
            <Text style={styles.verseBadgeText}>
              {totalVerses > 1
                ? `Ayah ${displayAyah} (${displayAyah - fromVerse + 1}/${totalVerses})`
                : `Ayah ${displayAyah}`}
            </Text>
          </View>
        </View>

        <Text style={styles.timeText}>{formatTime(durationMillis)}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: 6,
  },
  tooltipRow: {
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrubTooltip: {
    backgroundColor: '#1b263b',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#9bbfff',
  },
  scrubTooltipText: {
    color: '#9bbfff',
    fontSize: 12,
    fontWeight: '700',
  },
  touchArea: {
    height: 44,
    justifyContent: 'center',
    position: 'relative',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 8,
    width: '100%',
  },
  segmentTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#192233',
    borderRadius: 3,
    overflow: 'hidden',
  },
  segmentTrackCurrent: {
    height: 8,
    backgroundColor: '#1b253a',
    borderColor: '#34466b',
    borderWidth: 0.8,
  },
  fill: {
    height: '100%',
    backgroundColor: '#8cb3ff',
    borderRadius: 3,
  },
  fillActive: {
    backgroundColor: '#9bbfff',
  },
  scrubberHandle: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffffff',
    borderWidth: 2.5,
    borderColor: '#8cb3ff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8cb3ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
    elevation: 6,
  },
  scrubberHandleActive: {
    transform: [{ scale: 1.25 }],
    borderColor: '#ffffff',
    backgroundColor: '#9bbfff',
  },
  scrubberHandleInnerDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#0a101d',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
    marginTop: 2,
  },
  metaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeText: {
    color: '#718096',
    fontSize: 12,
    fontWeight: '600',
  },
  verseBadge: {
    backgroundColor: '#131b2c',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293f',
  },
  verseBadgeText: {
    color: '#9bbfff',
    fontSize: 11,
    fontWeight: '600',
  },
});
