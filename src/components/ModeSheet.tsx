import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, space, radius, type } from '../theme';

export type PlayerMode = 'listen' | 'pitch' | 'ladder';

interface ModeSheetProps {
  visible: boolean;
  mode: PlayerMode;
  onSelect: (mode: PlayerMode) => void;
  onClose: () => void;
}

const OPTIONS: { key: PlayerMode; icon: React.ComponentProps<typeof Ionicons>['name']; title: string; detail: string; tone: string }[] = [
  { key: 'listen', icon: 'headset-outline', title: 'Listen', detail: 'Loops, repeats and word highlighting', tone: colors.sapphire },
  { key: 'pitch', icon: 'mic-outline', title: 'Pitch Match', detail: 'Trace the reciter’s melody with your voice', tone: colors.gold },
  { key: 'ladder', icon: 'layers-outline', title: 'Hifz Ladder', detail: 'Listen · recite · combine · climb', tone: colors.gold },
];

/** One place to switch what the player is doing. Replaces the header segmented pill. */
export const ModeSheet: React.FC<ModeSheetProps> = ({ visible, mode, onSelect, onClose }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={() => {}}>
        <View style={styles.grabber} />
        <Text style={styles.title}>Mode</Text>
        {OPTIONS.map(o => {
          const active = o.key === mode;
          return (
            <TouchableOpacity
              key={o.key}
              style={[styles.row, active && styles.rowActive]}
              activeOpacity={0.85}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onSelect(o.key);
              }}
            >
              <View style={[styles.iconWrap, { borderColor: active ? o.tone : colors.line }]}>
                <Ionicons name={o.icon} size={18} color={active ? o.tone : colors.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, active && { color: o.tone }]}>{o.title}</Text>
                <Text style={styles.rowDetail}>{o.detail}</Text>
              </View>
              {active && <Ionicons name="checkmark-circle" size={20} color={o.tone} />}
            </TouchableOpacity>
          );
        })}
      </Pressable>
    </Pressable>
  </Modal>
);

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(3, 5, 10, 0.72)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.surface,
    borderTopRightRadius: radius.surface,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingBottom: space.xxxl + 8,
    paddingTop: space.sm,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: space.md },
  title: { ...type.label, marginBottom: space.sm, marginLeft: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: space.sm,
  },
  rowActive: { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  rowTitle: { ...type.body, fontSize: 15.5, fontWeight: '700', color: colors.text },
  rowDetail: { ...type.bodyMuted, marginTop: 1 },
});
