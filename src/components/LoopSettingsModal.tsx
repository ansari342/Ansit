import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LoopSettings, LoopMode } from '../types';

interface LoopSettingsModalProps {
  visible: boolean;
  settings: LoopSettings;
  onUpdateSettings: (settings: LoopSettings) => void;
  onClose: () => void;
}

export const LoopSettingsModal: React.FC<LoopSettingsModalProps> = ({
  visible,
  settings,
  onUpdateSettings,
  onClose,
}) => {
  const repeatCounts = [1, 2, 3, 5, 10];
  const speeds = [0.75, 1.0, 1.25, 1.5];
  const delays = [0, 1, 2, 3];

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Ionicons name="options-outline" size={20} color="#9bbfff" style={{ marginRight: 8 }} />
              <Text style={styles.title}>Audio & Loop Settings</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#8a95aa" />
            </TouchableOpacity>
          </View>

          {/* Section 1: Loop Mode */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>LOOP RANGE MODE</Text>
            <View style={styles.optionsRow}>
              <TouchableOpacity
                style={[styles.chip, settings.mode === 'range' && styles.chipActive]}
                onPress={() => onUpdateSettings({ ...settings, mode: 'range' })}
              >
                <Ionicons
                  name="repeat"
                  size={15}
                  color={settings.mode === 'range' ? '#0a101d' : '#8a95aa'}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.chipText, settings.mode === 'range' && styles.chipTextActive]}>
                  Loop Range
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.chip, settings.mode === 'single' && styles.chipActive]}
                onPress={() => onUpdateSettings({ ...settings, mode: 'single' })}
              >
                <Ionicons
                  name="repeat-outline"
                  size={15}
                  color={settings.mode === 'single' ? '#0a101d' : '#8a95aa'}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.chipText, settings.mode === 'single' && styles.chipTextActive]}>
                  Single Verse
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.chip, settings.mode === 'off' && styles.chipActive]}
                onPress={() => onUpdateSettings({ ...settings, mode: 'off' })}
              >
                <Text style={[styles.chipText, settings.mode === 'off' && styles.chipTextActive]}>
                  Play Once
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Section 2: Repeat per verse */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>REPEAT EACH VERSE (HIFZ MEMORIZATION)</Text>
            <View style={styles.optionsRow}>
              {repeatCounts.map(count => (
                <TouchableOpacity
                  key={count}
                  style={[
                    styles.circleOption,
                    settings.verseRepeatCount === count && styles.circleOptionActive,
                  ]}
                  onPress={() => onUpdateSettings({ ...settings, verseRepeatCount: count })}
                >
                  <Text
                    style={[
                      styles.circleOptionText,
                      settings.verseRepeatCount === count && styles.circleOptionTextActive,
                    ]}
                  >
                    {count}x
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Section 3: Playback Speed */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>PLAYBACK SPEED</Text>
            <View style={styles.optionsRow}>
              {speeds.map(sp => (
                <TouchableOpacity
                  key={sp}
                  style={[
                    styles.chip,
                    settings.playbackSpeed === sp && styles.chipActive,
                  ]}
                  onPress={() => onUpdateSettings({ ...settings, playbackSpeed: sp })}
                >
                  <Text
                    style={[
                      styles.chipText,
                      settings.playbackSpeed === sp && styles.chipTextActive,
                    ]}
                  >
                    {sp}x
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Section 4: Delay Between Verses */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>PAUSE BETWEEN VERSES</Text>
            <View style={styles.optionsRow}>
              {delays.map(d => (
                <TouchableOpacity
                  key={d}
                  style={[
                    styles.chip,
                    settings.delayBetweenVersesSeconds === d && styles.chipActive,
                  ]}
                  onPress={() =>
                    onUpdateSettings({ ...settings, delayBetweenVersesSeconds: d })
                  }
                >
                  <Text
                    style={[
                      styles.chipText,
                      settings.delayBetweenVersesSeconds === d && styles.chipTextActive,
                    ]}
                  >
                    {d === 0 ? 'None' : `${d} sec`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Done Button */}
          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>Save & Apply</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#121724',
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: '#1e283d',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7b879c',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#182030',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#222d42',
  },
  chipActive: {
    backgroundColor: '#9bbfff',
    borderColor: '#9bbfff',
  },
  chipText: {
    fontSize: 13,
    color: '#8a95aa',
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#0a101d',
    fontWeight: '700',
  },
  circleOption: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#182030',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#222d42',
  },
  circleOptionActive: {
    backgroundColor: '#9bbfff',
    borderColor: '#9bbfff',
  },
  circleOptionText: {
    fontSize: 14,
    color: '#8a95aa',
    fontWeight: '600',
  },
  circleOptionTextActive: {
    color: '#0a101d',
    fontWeight: '700',
  },
  doneBtn: {
    backgroundColor: '#9bbfff',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  doneBtnText: {
    color: '#0a101d',
    fontSize: 15,
    fontWeight: '700',
  },
});
