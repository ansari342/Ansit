import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { RECITERS } from '../data/reciters';
import { Reciter } from '../types';

interface ReciterPickerModalProps {
  visible: boolean;
  selectedReciter: Reciter;
  onSelect: (reciter: Reciter) => void;
  onClose: () => void;
}

export const ReciterPickerModal: React.FC<ReciterPickerModalProps> = ({
  visible,
  selectedReciter,
  onSelect,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredReciters = useMemo(() => {
    if (!searchQuery.trim()) return RECITERS;
    const q = searchQuery.toLowerCase().trim();
    return RECITERS.filter(
      r =>
        r.name.toLowerCase().includes(q) ||
        r.shortName.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color="#94a3b8" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Select Reciter</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color="#64748b" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search reciter (e.g. Raad, Sudais, Minshawi)..."
            placeholderTextColor="#64748b"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color="#64748b" />
            </TouchableOpacity>
          )}
        </View>

        {/* Reciter List */}
        <FlatList
          data={filteredReciters}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 30 }}
          renderItem={({ item }) => {
            const isSelected = item.id === selectedReciter.id;
            return (
              <TouchableOpacity
                style={[styles.itemContainer, isSelected && styles.itemSelected]}
                activeOpacity={0.7}
                onPress={() => {
                  try {
                    Haptics.selectionAsync();
                  } catch (e) {}
                  onSelect(item);
                  onClose();
                }}
              >
                <View style={styles.avatarBadge}>
                  <MaterialCommunityIcons
                    name="account-voice"
                    size={22}
                    color={isSelected ? '#9bbfff' : '#64748b'}
                  />
                </View>

                <View style={styles.itemInfo}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.reciterName, isSelected && styles.textSelected]}>
                      {item.name}
                    </Text>
                    {item.badge && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{item.badge}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.reciterSub}>
                    {item.isSurahBased
                      ? 'Full Surah Recitation • MP3Quran'
                      : 'Verse-by-Verse • EveryAyah'}
                  </Text>
                </View>

                {isSelected ? (
                  <View style={styles.checkBadge}>
                    <Ionicons name="checkmark-circle" size={24} color="#9bbfff" />
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={18} color="#2d3748" />
                )}
              </TouchableOpacity>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080b11',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#161c2a',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121724',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121724',
    margin: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e2638',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 15,
  },
  itemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0e1420',
  },
  itemSelected: {
    backgroundColor: '#141d30',
  },
  avatarBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#161d2d',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: '#232d42',
  },
  itemInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 2,
  },
  reciterName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  textSelected: {
    color: '#9bbfff',
    fontWeight: '700',
  },
  badge: {
    backgroundColor: '#16253d',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#263b60',
  },
  badgeText: {
    color: '#8cb3ff',
    fontSize: 10,
    fontWeight: '700',
  },
  reciterSub: {
    color: '#718096',
    fontSize: 12,
  },
  checkBadge: {
    marginLeft: 8,
  },
});
