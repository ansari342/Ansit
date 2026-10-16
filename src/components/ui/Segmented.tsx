import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, radius } from '../../theme';

export interface SegmentOption<K extends string> {
  key: K;
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}

interface SegmentedProps<K extends string> {
  options: SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  /** sapphire = listening / navigation, gold = the user's voice */
  tone?: 'sapphire' | 'gold';
  size?: 'sm' | 'md';
  style?: ViewStyle;
}

/** The one segmented control used across the app (header tabs, sub-modes, setup options). */
export function Segmented<K extends string>({ options, value, onChange, tone = 'sapphire', size = 'md', style }: SegmentedProps<K>) {
  const accent = tone === 'gold' ? colors.gold : colors.sapphire;
  const activeBg = tone === 'gold' ? colors.goldTint : '#1a2842';
  const activeLine = tone === 'gold' ? colors.goldDeep : colors.sapphireDeep;
  return (
    <View style={[styles.track, style]}>
      {options.map(o => {
        const active = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            style={[styles.item, size === 'sm' && styles.itemSm, active && { backgroundColor: activeBg, borderColor: activeLine }]}
            activeOpacity={0.85}
            onPress={() => {
              if (active) return;
              Haptics.selectionAsync().catch(() => {});
              onChange(o.key);
            }}
          >
            {o.icon && <Ionicons name={o.icon} size={size === 'sm' ? 12 : 13} color={active ? accent : colors.textMuted} />}
            <Text style={[styles.label, size === 'sm' && styles.labelSm, active && { color: accent }]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: '#0a0f1a',
    borderWidth: 1,
    borderColor: '#1c273d',
    borderRadius: radius.pill,
    padding: 3,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  itemSm: { paddingHorizontal: 11, paddingVertical: 5 },
  label: { fontSize: 12.5, fontWeight: '800', color: colors.textMuted },
  labelSm: { fontSize: 12, fontWeight: '700' },
});
