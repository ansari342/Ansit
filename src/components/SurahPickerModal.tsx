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
import { Ionicons } from '@expo/vector-icons';
import { SURAHS } from '../data/surahs';
import { Surah } from '../types';

interface SurahPickerModalProps {
  visible: boolean;
  selectedSurah: Surah;
  onSelect: (surah: Surah) => void;
  onClose: () => void;
}

export const SurahPickerModal: React.FC<SurahPickerModalProps> = ({
  visible,
  selectedSurah,
  onSelect,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSurahs = useMemo(() => {
    if (!searchQuery.trim()) return SURAHS;
    const q = searchQuery.toLowerCase().trim();
    return SURAHS.filter(
      s =>
        s.englishName.toLowerCase().includes(q) ||
        s.englishNameTranslation.toLowerCase().includes(q) ||
        s.name.includes(q) ||
        s.number.toString() === q
    );
  }, [searchQuery]);

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#94a3b8" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Select Surah</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color="#64748b" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or number (e.g. Mulk, 67)..."
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

        {/* Surah List */}
        <FlatList
          data={filteredSurahs}
          keyExtractor={item => item.number.toString()}
          initialNumToRender={18}
          maxToRenderPerBatch={25}
          windowSize={8}
          removeClippedSubviews={true}
          getItemLayout={(_, index) => ({ length: 66, offset: 66 * index, index })}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isSelected = item.number === selectedSurah.number;
            return (
              <TouchableOpacity
                style={[styles.itemContainer, isSelected && styles.itemSelected]}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                <View style={styles.numberBadge}>
                  <Text style={styles.numberText}>{item.number}</Text>
                </View>
                <View style={styles.itemInfo}>
                  <Text style={[styles.englishName, isSelected && styles.textSelected]}>
                    {item.englishName}
                  </Text>
                  <Text style={styles.translationName}>
                    {item.englishNameTranslation} • {item.numberOfAyahs} verses
                  </Text>
                </View>
                <Text style={styles.arabicName}>{item.name}</Text>
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
  closeButton: {
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
    backgroundColor: '#151d2f',
  },
  numberBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#161d2d',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: '#232d42',
  },
  numberText: {
    color: '#9bbfff',
    fontWeight: '700',
    fontSize: 14,
  },
  itemInfo: {
    flex: 1,
  },
  englishName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  textSelected: {
    color: '#9bbfff',
  },
  translationName: {
    color: '#8a95aa',
    fontSize: 13,
  },
  arabicName: {
    color: '#8a95aa',
    fontSize: 18,
    fontFamily: 'System',
    marginLeft: 8,
  },
});
