import React, { useRef } from 'react';
import { Animated, TouchableWithoutFeedback, ViewStyle, StyleProp, Insets } from 'react-native';
import * as Haptics from 'expo-haptics';

interface BouncyTouchableProps {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  children: React.ReactNode;
  disabled?: boolean;
  triggerOnPressIn?: boolean;
  hitSlop?: Insets;
}

const DEFAULT_HIT_SLOP: Insets = { top: 10, bottom: 10, left: 10, right: 10 };

export const BouncyTouchable: React.FC<BouncyTouchableProps> = ({
  onPress,
  style,
  scaleTo = 0.9,
  children,
  disabled = false,
  triggerOnPressIn = false,
  hitSlop = DEFAULT_HIT_SLOP,
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    Animated.spring(scaleAnim, {
      toValue: scaleTo,
      speed: 45,
      bounciness: 4,
      useNativeDriver: true,
    }).start();

    if (triggerOnPressIn && onPress) {
      onPress();
    }
  };

  const handlePressOut = () => {
    if (disabled) return;
    Animated.spring(scaleAnim, {
      toValue: 1,
      speed: 35,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  };

  return (
    <TouchableWithoutFeedback
      onPress={triggerOnPressIn ? undefined : onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      delayPressIn={0}
      delayPressOut={0}
      hitSlop={hitSlop}
      disabled={disabled}
    >
      <Animated.View style={[style, { transform: [{ scale: scaleAnim }] }]}>
        {children}
      </Animated.View>
    </TouchableWithoutFeedback>
  );
};
