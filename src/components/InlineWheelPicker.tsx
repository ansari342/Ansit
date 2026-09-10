import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

interface InlineWheelPickerProps {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (val: number) => void;
  onScrollStart?: () => void;
  onScrollEnd?: () => void;
  itemHeight?: number;
}

const ITEM_HEIGHT = 46;

export const InlineWheelPicker: React.FC<InlineWheelPickerProps> = React.memo(({
  label,
  min,
  max,
  value,
  onChange,
  onScrollStart,
  onScrollEnd,
  itemHeight = ITEM_HEIGHT,
}) => {
  const scrollRef = useRef<ScrollView>(null);
  const lastIndexRef = useRef<number>(value - min);
  const isScrollingRef = useRef<boolean>(false);
  const lastHapticTimeRef = useRef<number>(0);
  const stepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const valueRef = useRef<number>(value);
  valueRef.current = value;

  const safeMax = Math.max(min, max);
  const items = useMemo(
    () => Array.from({ length: safeMax - min + 1 }, (_, i) => min + i),
    [safeMax, min]
  );
  const initialOffsetY = Math.max(0, (value - min) * itemHeight);

  // Sync scroll position when value changes externally (e.g. preset clicked or clamped)
  useEffect(() => {
    const targetIndex = value - min;
    if (targetIndex !== lastIndexRef.current && !isScrollingRef.current) {
      lastIndexRef.current = targetIndex;
      scrollRef.current?.scrollTo({
        y: targetIndex * itemHeight,
        animated: true,
      });
    }
  }, [value, min, itemHeight]);

  const triggerHaptic = useCallback(() => {
    const now = Date.now();
    if (now - lastHapticTimeRef.current > 40) {
      lastHapticTimeRef.current = now;
      try {
        Haptics.selectionAsync();
      } catch (err) {}
    }
  }, []);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const index = Math.round(y / itemHeight);
    const clampedIndex = Math.max(0, Math.min(items.length - 1, index));

    if (clampedIndex !== lastIndexRef.current) {
      lastIndexRef.current = clampedIndex;
      triggerHaptic();
      onChange(items[clampedIndex]);
    }
  }, [itemHeight, items, onChange, triggerHaptic]);

  const handleItemPress = useCallback((itemVal: number) => {
    const targetIndex = itemVal - min;
    lastIndexRef.current = targetIndex;
    try {
      Haptics.selectionAsync();
    } catch (err) {}
    scrollRef.current?.scrollTo({
      y: targetIndex * itemHeight,
      animated: true,
    });
    onChange(itemVal);
  }, [min, itemHeight, onChange]);

  const handleStep = useCallback((delta: number) => {
    const currentVal = valueRef.current;
    const nextVal = Math.max(min, Math.min(safeMax, currentVal + delta));
    if (nextVal !== currentVal) {
      handleItemPress(nextVal);
    }
  }, [min, safeMax, handleItemPress]);

  // Continuous stepping when pressing and holding the stepper arrow
  const startStepping = useCallback((delta: number) => {
    handleStep(delta);
    stepIntervalRef.current = setInterval(() => {
      handleStep(delta);
    }, 85);
  }, [handleStep]);

  const stopStepping = useCallback(() => {
    if (stepIntervalRef.current) {
      clearInterval(stepIntervalRef.current);
      stepIntervalRef.current = null;
    }
  }, []);

  return (
    <View style={styles.container}>
      {/* Column Header with Step Arrows */}
      <View style={styles.headerRow}>
        <Text style={styles.label}>{label}</Text>
      </View>

      {/* Up Stepper Arrow with press & hold */}
      <TouchableOpacity
        style={styles.arrowStepBtn}
        activeOpacity={0.6}
        onPressIn={() => startStepping(-1)}
        onPressOut={stopStepping}
        hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}
      >
        <Ionicons name="chevron-up" size={20} color="#9bbfff" />
      </TouchableOpacity>

      {/* Wheel Box (Shows 3 items: prev, current in lens, next) */}
      <View style={[styles.wheelWrapper, { height: itemHeight * 3 }]}>
        {/* iOS-Style Selection Lens */}
        <View
          style={[
            styles.selectionLens,
            {
              top: itemHeight,
              height: itemHeight,
            },
          ]}
          pointerEvents="none"
        />

        <ScrollView
          ref={scrollRef}
          style={styles.scrollView}
          contentOffset={{ x: 0, y: initialOffsetY }}
          showsVerticalScrollIndicator={false}
          snapToInterval={itemHeight}
          snapToAlignment="center"
          decelerationRate="normal"
          disableIntervalMomentum={false}
          nestedScrollEnabled={true}
          removeClippedSubviews={true}
          onTouchStart={() => {
            isScrollingRef.current = true;
            onScrollStart?.();
          }}
          onScrollBeginDrag={() => {
            isScrollingRef.current = true;
            onScrollStart?.();
          }}
          onMomentumScrollBegin={() => {
            isScrollingRef.current = true;
          }}
          onScrollEndDrag={e => {
            if (!e.nativeEvent.velocity?.y) {
              isScrollingRef.current = false;
              onScrollEnd?.();
              handleScroll(e);
            }
          }}
          onMomentumScrollEnd={e => {
            isScrollingRef.current = false;
            onScrollEnd?.();
            handleScroll(e);
          }}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{
            paddingVertical: itemHeight, // Offset so first and last items center in lens
          }}
        >
          {items.map(item => {
            const isSelected = item === value;
            return (
              <TouchableOpacity
                key={item}
                style={[styles.item, { height: itemHeight }]}
                activeOpacity={0.75}
                onPress={() => handleItemPress(item)}
              >
                <Text
                  style={[
                    styles.itemText,
                    isSelected ? styles.itemTextSelected : styles.itemTextNormal,
                  ]}
                >
                  {item}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Down Stepper Arrow with press & hold */}
      <TouchableOpacity
        style={styles.arrowStepBtn}
        activeOpacity={0.6}
        onPressIn={() => startStepping(1)}
        onPressOut={stopStepping}
        hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}
      >
        <Ionicons name="chevron-down" size={20} color="#9bbfff" />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  headerRow: {
    alignItems: 'center',
    marginBottom: 4,
  },
  label: {
    color: '#8a95aa',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  arrowStepBtn: {
    width: 32,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 2,
  },
  wheelWrapper: {
    width: '100%',
    backgroundColor: '#0c101a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1d273e',
    overflow: 'hidden',
    position: 'relative',
  },
  selectionLens: {
    position: 'absolute',
    left: 6,
    right: 6,
    backgroundColor: '#1a263d',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#435b88',
    zIndex: 1,
  },
  scrollView: {
    flex: 1,
    width: '100%',
    zIndex: 2,
  },
  item: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    textAlign: 'center',
  },
  itemTextSelected: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800',
  },
  itemTextNormal: {
    color: '#94a3b8',
    fontSize: 17,
    fontWeight: '600',
    opacity: 0.8,
  },
});
