import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';

interface SoundwaveVisualizerProps {
  isPlaying: boolean;
  color?: string;
  barCount?: number;
  maxHeight?: number;
}

export const SoundwaveVisualizer: React.FC<SoundwaveVisualizerProps> = React.memo(({
  isPlaying,
  color = '#9bbfff',
  barCount = 5,
  maxHeight = 20,
}) => {
  const animValues = useRef(
    Array.from({ length: barCount }, () => new Animated.Value(0.2))
  ).current;

  useEffect(() => {
    const animations: Animated.CompositeAnimation[] = [];

    if (isPlaying) {
      animValues.forEach((val, index) => {
        const minScale = 0.2;
        const maxScale = 0.45 + 0.55 * Math.sin((index + 1) * 1.3);
        const duration = 380 + index * 80;

        const anim = Animated.loop(
          Animated.sequence([
            Animated.timing(val, {
              toValue: maxScale,
              duration,
              useNativeDriver: true,
            }),
            Animated.timing(val, {
              toValue: minScale,
              duration: duration * 0.9,
              useNativeDriver: true,
            }),
          ])
        );
        animations.push(anim);
        anim.start();
      });
    } else {
      animValues.forEach(val => {
        Animated.timing(val, {
          toValue: 0.2,
          duration: 250,
          useNativeDriver: true,
        }).start();
      });
    }

    return () => {
      animations.forEach(a => a.stop());
    };
  }, [isPlaying, barCount, maxHeight]);

  return (
    <View style={styles.container}>
      {animValues.map((val, idx) => (
        <Animated.View
          key={idx}
          style={[
            styles.bar,
            {
              backgroundColor: color,
              height: maxHeight,
              transform: [{ scaleY: val }],
            },
          ]}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 24,
    paddingHorizontal: 4,
  },
  bar: {
    width: 3.5,
    borderRadius: 2,
  },
});
