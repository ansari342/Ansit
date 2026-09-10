import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Surah, Reciter } from '../types';
import { RECITERS } from '../data/reciters';
import { SURAHS } from '../data/surahs';
import { SurahPickerModal } from './SurahPickerModal';
import { ReciterPickerModal } from './ReciterPickerModal';
import { InlineWheelPicker } from './InlineWheelPicker';
import { BouncyTouchable } from './BouncyTouchable';
import { AnalyticsModal } from './AnalyticsModal';
import { recordListenSession } from '../services/analyticsService';
import {
  HistoryItem,
  getRecentlyPlayed,
  addRecentlyPlayed,
  removeRecentlyPlayed,
} from '../services/historyService';
import {
  saveLastSession,
  getLastSession,
  saveSurahRanges,
  getSurahRanges,
} from '../services/sessionStorage';

interface HomeScreenProps {
  onStartPlayback: (
    surah: Surah,
    fromVerse: number,
    toVerse: number,
    reciter: Reciter
  ) => void;
  onOpenSettings: () => void;
  activeSession?: {
    surah: Surah;
    fromVerse: number;
    toVerse: number;
    reciter: Reciter;
  };
  onSelectionChange?: (
    surah: Surah,
    fromVerse: number,
    toVerse: number,
    reciter: Reciter
  ) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = React.memo(({
  onStartPlayback,
  onOpenSettings,
  activeSession,
  onSelectionChange,
}) => {
  const defaultSurah = activeSession?.surah || SURAHS.find(s => s.number === 1) || SURAHS[0];
  const [selectedSurah, setSelectedSurah] = useState<Surah>(defaultSurah);
  const [selectedReciter, setSelectedReciter] = useState<Reciter>(
    activeSession?.reciter || RECITERS[0]
  );
  const [fromVerse, setFromVerse] = useState<number>(activeSession?.fromVerse || 1);
  const [toVerse, setToVerse] = useState<number>(
    activeSession?.toVerse || defaultSurah.numberOfAyahs
  );

  const [recentlyPlayedList, setRecentlyPlayedList] = useState<HistoryItem[]>([]);
  const [surahPickerVisible, setSurahPickerVisible] = useState(false);
  const [reciterPickerVisible, setReciterPickerVisible] = useState(false);
  const [analyticsModalVisible, setAnalyticsModalVisible] = useState(false);
  const [isParentScrollEnabled, setIsParentScrollEnabled] = useState(true);

  // Smart Per-Surah Verse Memory: remembers the custom verse range selected for each surah
  const [surahRanges, setSurahRanges] = useState<Record<number, { from: number; to: number }>>({
    [defaultSurah.number]: { from: fromVerse, to: toVerse },
  });

  const lastActiveSessionKey = useRef<string>(
    activeSession
      ? `${activeSession.surah.number}_${activeSession.fromVerse}_${activeSession.toVerse}_${activeSession.reciter.id}`
      : ''
  );

  // Load saved session, custom per-surah ranges, and recently played on mount
  const loadSavedState = async () => {
    try {
      const [savedRanges, savedSession, list] = await Promise.all([
        getSurahRanges(),
        getLastSession(),
        getRecentlyPlayed(),
      ]);

      setRecentlyPlayedList(list || []);

      const mergedRanges: Record<number, { from: number; to: number }> = {
        ...savedRanges,
      };
      if (list && list.length > 0) {
        for (const item of list) {
          if (!mergedRanges[item.surahNumber]) {
            mergedRanges[item.surahNumber] = {
              from: item.fromVerse,
              to: item.toVerse,
            };
          }
        }
      }

      // If activeSession is not passed yet, restore from savedSession
      const sessionToApply = activeSession || (savedSession ? {
        surah: SURAHS.find(s => s.number === savedSession.surahNumber) || defaultSurah,
        fromVerse: savedSession.fromVerse,
        toVerse: savedSession.toVerse,
        reciter: RECITERS.find(r => r.id === savedSession.reciterId) || RECITERS[0],
      } : null);

      if (sessionToApply) {
        const safeFrom = Math.max(
          1,
          Math.min(sessionToApply.fromVerse, sessionToApply.surah.numberOfAyahs)
        );
        const safeTo = Math.max(
          safeFrom,
          Math.min(sessionToApply.toVerse, sessionToApply.surah.numberOfAyahs)
        );

        setSelectedSurah(sessionToApply.surah);
        setFromVerse(safeFrom);
        setToVerse(safeTo);
        setSelectedReciter(sessionToApply.reciter);

        mergedRanges[sessionToApply.surah.number] = { from: safeFrom, to: safeTo };
        lastActiveSessionKey.current = `${sessionToApply.surah.number}_${safeFrom}_${safeTo}_${sessionToApply.reciter.id}`;
      }

      setSurahRanges(mergedRanges);
    } catch (e) {
      console.warn('Failed to load saved state in HomeScreen:', e);
    }
  };

  useEffect(() => {
    loadSavedState();
  }, []);

  // Synchronize when activeSession updates externally (e.g. paused/minimized from player or played from LandingScreen)
  useEffect(() => {
    if (activeSession) {
      const key = `${activeSession.surah.number}_${activeSession.fromVerse}_${activeSession.toVerse}_${activeSession.reciter.id}`;
      if (lastActiveSessionKey.current !== key) {
        lastActiveSessionKey.current = key;
        const safeFrom = Math.max(
          1,
          Math.min(activeSession.fromVerse, activeSession.surah.numberOfAyahs)
        );
        const safeTo = Math.max(
          safeFrom,
          Math.min(activeSession.toVerse, activeSession.surah.numberOfAyahs)
        );
        setSelectedSurah(activeSession.surah);
        setFromVerse(safeFrom);
        setToVerse(safeTo);
        setSelectedReciter(activeSession.reciter);
        setSurahRanges(prev => ({
          ...prev,
          [activeSession.surah.number]: { from: safeFrom, to: safeTo },
        }));
      }
    }
  }, [activeSession]);

  const handleSelectSurah = (surah: Surah) => {
    setSelectedSurah(surah);
    // Smart default: If user previously selected or played a range for this surah, default to it!
    const saved = surahRanges[surah.number];
    let targetFrom = 1;
    let targetTo = surah.numberOfAyahs;

    if (saved) {
      targetFrom = Math.max(1, Math.min(saved.from, surah.numberOfAyahs));
      targetTo = Math.max(targetFrom, Math.min(saved.to, surah.numberOfAyahs));
    } else {
      const inRecent = recentlyPlayedList.find(item => item.surahNumber === surah.number);
      if (inRecent) {
        targetFrom = Math.max(1, Math.min(inRecent.fromVerse, surah.numberOfAyahs));
        targetTo = Math.max(targetFrom, Math.min(inRecent.toVerse, surah.numberOfAyahs));
      }
    }

    setFromVerse(targetFrom);
    setToVerse(targetTo);

    const updatedRanges = {
      ...surahRanges,
      [surah.number]: { from: targetFrom, to: targetTo },
    };
    setSurahRanges(updatedRanges);
    saveSurahRanges(updatedRanges);

    lastActiveSessionKey.current = `${surah.number}_${targetFrom}_${targetTo}_${selectedReciter.id}`;
    saveLastSession(surah.number, targetFrom, targetTo, selectedReciter.id);
    onSelectionChange?.(surah, targetFrom, targetTo, selectedReciter);
  };

  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncePersistSession = useCallback(
    (surah: Surah, from: number, to: number, reciter: Reciter) => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
      persistTimeoutRef.current = setTimeout(() => {
        setSurahRanges(prev => {
          const updated = {
            ...prev,
            [surah.number]: { from, to },
          };
          saveSurahRanges(updated);
          return updated;
        });
        lastActiveSessionKey.current = `${surah.number}_${from}_${to}_${reciter.id}`;
        saveLastSession(surah.number, from, to, reciter.id);
        onSelectionChange?.(surah, from, to, reciter);
      }, 250);
    },
    [onSelectionChange]
  );

  const handleFromWheelChange = useCallback(
    (newFrom: number) => {
      setFromVerse(newFrom);
      const targetTo = newFrom > toVerse ? newFrom : toVerse;
      if (newFrom > toVerse) {
        setToVerse(newFrom);
      }
      debouncePersistSession(selectedSurah, newFrom, targetTo, selectedReciter);
    },
    [toVerse, selectedSurah, selectedReciter, debouncePersistSession]
  );

  const handleToWheelChange = useCallback(
    (newTo: number) => {
      setToVerse(newTo);
      const targetFrom = newTo < fromVerse ? newTo : fromVerse;
      if (newTo < fromVerse) {
        setFromVerse(newTo);
      }
      debouncePersistSession(selectedSurah, targetFrom, newTo, selectedReciter);
    },
    [fromVerse, selectedSurah, selectedReciter, debouncePersistSession]
  );

  const handleWheelScrollStart = useCallback(() => setIsParentScrollEnabled(false), []);
  const handleWheelScrollEnd = useCallback(() => setIsParentScrollEnabled(true), []);

  const handleSelectReciter = (reciter: Reciter) => {
    setSelectedReciter(reciter);
    lastActiveSessionKey.current = `${selectedSurah.number}_${fromVerse}_${toVerse}_${reciter.id}`;
    saveLastSession(selectedSurah.number, fromVerse, toVerse, reciter.id);
    onSelectionChange?.(selectedSurah, fromVerse, toVerse, reciter);
  };

  const handlePlaySession = async (
    surah: Surah,
    from: number,
    to: number,
    reciter: Reciter
  ) => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {}

    const updatedRanges = {
      ...surahRanges,
      [surah.number]: { from, to },
    };
    setSurahRanges(updatedRanges);
    saveSurahRanges(updatedRanges);

    lastActiveSessionKey.current = `${surah.number}_${from}_${to}_${reciter.id}`;
    saveLastSession(surah.number, from, to, reciter.id);
    onSelectionChange?.(surah, from, to, reciter);

    const updated = await addRecentlyPlayed(surah, from, to, reciter);
    if (updated.length > 0) {
      setRecentlyPlayedList(updated);
    }

    recordListenSession(surah, from, to, reciter).catch(() => {});

    onStartPlayback(surah, from, to, reciter);
  };

  const handlePlayRecentlyPlayed = (item: HistoryItem) => {
    const surah = SURAHS.find(s => s.number === item.surahNumber);
    const reciter =
      RECITERS.find(r => r.id === item.reciterId) || RECITERS[0];
    if (surah) {
      setSelectedSurah(surah);
      setFromVerse(item.fromVerse);
      setToVerse(item.toVerse);
      setSelectedReciter(reciter);
      setSurahRanges(prev => ({
        ...prev,
        [surah.number]: { from: item.fromVerse, to: item.toVerse },
      }));
      handlePlaySession(surah, item.fromVerse, item.toVerse, reciter);
    }
  };

  const handleRemoveHistoryItem = async (e: any, itemId: string) => {
    e.stopPropagation();
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {}

    const updated = await removeRecentlyPlayed(itemId);
    setRecentlyPlayedList(updated);
  };

  // Quick reciters for the top chips: first 4, plus current selected if not in first 4
  const quickReciters = React.useMemo(() => {
    const list = RECITERS.slice(0, 4);
    if (!list.some(r => r.id === selectedReciter.id)) {
      list.push(selectedReciter);
    }
    return list;
  }, [selectedReciter]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#080b11" />

      {/* Top Header: Ansit Brand */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitleAnsit}>Ansit</Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={onOpenSettings}>
            <Ionicons name="settings-outline" size={20} color="#a0aec0" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.avatarBtn}
            activeOpacity={0.7}
            onPress={() => {
              try {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              } catch (e) {}
              setAnalyticsModalVisible(true);
            }}
          >
            <Ionicons name="person" size={17} color="#080b11" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        scrollEnabled={isParentScrollEnabled}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* SUGGESTED VERSES Section Header */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeading}>SUGGESTED VERSES</Text>
          {recentlyPlayedList.length > 0 && (
            <Text style={styles.sectionCounter}>
              {recentlyPlayedList.length} recent
            </Text>
          )}
        </View>

        {/* 1. COMPACT HORIZONTAL SCROLL FOR SUGGESTED VERSES */}
        {recentlyPlayedList.length === 0 ? (
          <View style={styles.emptyHistoryCard}>
            <Text style={styles.emptyHistoryText}>
              No recent history yet. Play a surah to see it here!
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.recentHorizontalScroll}
            contentContainerStyle={styles.recentHorizontalContent}
          >
            {recentlyPlayedList.map(item => (
              <BouncyTouchable
                key={item.id}
                style={styles.recentHorizontalCard}
                onPress={() => handlePlayRecentlyPlayed(item)}
              >
                {/* Play Icon Circle */}
                <View style={styles.recentPlayIconCircle}>
                  <Ionicons name="play" size={12} color="#9bbfff" style={{ marginLeft: 2 }} />
                </View>

                {/* Surah, Range & Reciter */}
                <View style={styles.recentInfoContainer}>
                  <View style={styles.recentPrimaryRow}>
                    <Text style={styles.recentCardTitle} numberOfLines={1}>
                      {item.surahName}
                    </Text>
                    <Text style={styles.recentVerseBadge}>
                      {item.fromVerse}–{item.toVerse}
                    </Text>
                  </View>
                  <Text style={styles.recentCardSubtitle} numberOfLines={1}>
                    {item.reciterName}
                  </Text>
                </View>

                {/* Remove Button */}
                <TouchableOpacity
                  style={styles.removeHistoryBtn}
                  activeOpacity={0.6}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={(e) => handleRemoveHistoryItem(e, item.id)}
                >
                  <Ionicons name="close" size={13} color="#55647a" />
                </TouchableOpacity>
              </BouncyTouchable>
            ))}
          </ScrollView>
        )}

        {/* 2. SELECT RECITER SECTION WITH PLUS BUTTON */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeading}>SELECT RECITER</Text>
          <TouchableOpacity
            onPress={() => setReciterPickerVisible(true)}
            style={styles.seeAllBtn}
          >
            <Text style={styles.seeAllText}>All ({RECITERS.length})</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.reciterRow}
          contentContainerStyle={styles.reciterContent}
        >
          {quickReciters.map(r => {
            const isSelected = r.id === selectedReciter.id;
            return (
              <BouncyTouchable
                key={r.id}
                style={[
                  styles.reciterChip,
                  isSelected && styles.reciterChipActive,
                ]}
                onPress={() => handleSelectReciter(r)}
              >
                <Text
                  style={[
                    styles.reciterChipText,
                    isSelected && styles.reciterChipTextActive,
                  ]}
                >
                  {r.shortName}
                </Text>
              </BouncyTouchable>
            );
          })}

          {/* PLUS BUTTON AT THE END TO OPEN ALL RECITERS */}
          <BouncyTouchable
            style={styles.moreRecitersBtn}
            onPress={() => setReciterPickerVisible(true)}
          >
            <Ionicons name="add" size={18} color="#9bbfff" style={{ marginRight: 4 }} />
            <Text style={styles.moreRecitersText}>More</Text>
          </BouncyTouchable>
        </ScrollView>

        {/* 3. MAIN SELECTION CARD */}
        <View style={styles.selectionCard}>
          {/* Select Surah Dropdown */}
          <Text style={styles.cardLabel}>SELECT SURAH</Text>
          <TouchableOpacity
            style={styles.dropdownBox}
            activeOpacity={0.7}
            onPress={() => setSurahPickerVisible(true)}
          >
            <Text style={styles.dropdownText}>
              {selectedSurah.number.toString().padStart(2, '0')}{' '}
              {selectedSurah.englishName}
            </Text>
            <Ionicons name="chevron-down" size={20} color="#718096" />
          </TouchableOpacity>

          {/* DIRECT PHYSICAL EMBEDDED VERSE WHEEL (Date of birth style) */}
          <View style={styles.rangeHeaderRow}>
            <Text style={styles.cardLabel}>VERSE RANGE</Text>
            <View style={styles.rangeSummaryPill}>
              <Text style={styles.rangeSummaryText}>
                {fromVerse}–{toVerse}
              </Text>
            </View>
          </View>

          {/* Physical Side-by-Side Tumbler Wheels */}
          <View style={styles.embeddedWheelsRow}>
            <InlineWheelPicker
              label="From"
              min={1}
              max={selectedSurah.numberOfAyahs}
              value={fromVerse}
              onChange={handleFromWheelChange}
              onScrollStart={handleWheelScrollStart}
              onScrollEnd={handleWheelScrollEnd}
            />

            <View style={styles.wheelArrowDivider}>
              <Ionicons name="arrow-forward" size={18} color="#4a5568" />
            </View>

            <InlineWheelPicker
              label="To"
              min={1}
              max={selectedSurah.numberOfAyahs}
              value={toVerse}
              onChange={handleToWheelChange}
              onScrollStart={handleWheelScrollStart}
              onScrollEnd={handleWheelScrollEnd}
            />
          </View>
        </View>

        {/* PLAY NOW Button with Bouncy Spring Physics */}
        <BouncyTouchable
          style={styles.playNowBtn}
          onPress={() =>
            handlePlaySession(selectedSurah, fromVerse, toVerse, selectedReciter)
          }
        >
          <Ionicons
            name="play"
            size={22}
            color="#ffffff"
            style={{ marginRight: 10 }}
          />
          <Text style={styles.playNowText}>PLAY NOW</Text>
        </BouncyTouchable>
      </ScrollView>

      {/* Surah Picker Modal */}
      <SurahPickerModal
        visible={surahPickerVisible}
        selectedSurah={selectedSurah}
        onSelect={handleSelectSurah}
        onClose={() => setSurahPickerVisible(false)}
      />

      {/* Reciter Picker Modal */}
      <ReciterPickerModal
        visible={reciterPickerVisible}
        selectedReciter={selectedReciter}
        onSelect={handleSelectReciter}
        onClose={() => setReciterPickerVisible(false)}
      />

      {/* Analytics Insights Modal */}
      <AnalyticsModal
        visible={analyticsModalVisible}
        onClose={() => setAnalyticsModalVisible(false)}
        onPlayTopSession={(surahNum, fromV, toV) => {
          const targetSurah = SURAHS.find(s => s.number === surahNum);
          if (targetSurah) {
            setSelectedSurah(targetSurah);
            setFromVerse(fromV);
            setToVerse(toV);
            handlePlaySession(targetSurah, fromV, toV, selectedReciter);
          }
        }}
      />
    </SafeAreaView>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080b11',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerBrandRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  headerTitleAnsit: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerTitleArabic: {
    color: '#9bbfff',
    fontSize: 20,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBtn: {
    padding: 6,
  },
  avatarBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#9bbfff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8a95aa',
    letterSpacing: 1.2,
  },
  sectionCounter: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  seeAllBtn: {
    paddingVertical: 2,
  },
  seeAllText: {
    color: '#9bbfff',
    fontSize: 12,
    fontWeight: '600',
  },
  // Horizontal Recently Played Styles
  recentHorizontalScroll: {
    marginHorizontal: -20,
    marginBottom: 6,
  },
  recentHorizontalContent: {
    paddingHorizontal: 20,
    paddingVertical: 4,
  },
  recentHorizontalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1322',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#19243a',
    minWidth: 175,
  },
  recentPlayIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#141e32',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#24375b',
  },
  recentInfoContainer: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 6,
  },
  recentPrimaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  recentCardTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  recentVerseBadge: {
    color: '#9bbfff',
    fontSize: 12,
    fontWeight: '700',
  },
  recentCardSubtitle: {
    color: '#718096',
    fontSize: 11,
    fontWeight: '500',
  },
  removeHistoryBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  emptyHistoryCard: {
    backgroundColor: '#101522',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#182030',
    marginBottom: 8,
  },
  emptyHistoryText: {
    color: '#64748b',
    fontSize: 13,
  },
  // Reciter Row Styles
  reciterRow: {
    marginHorizontal: -20,
    marginBottom: 12,
  },
  reciterContent: {
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  reciterChip: {
    backgroundColor: '#121726',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#1d263b',
  },
  reciterChipActive: {
    backgroundColor: '#9bbfff',
    borderColor: '#9bbfff',
  },
  reciterChipText: {
    color: '#8a95aa',
    fontSize: 13,
    fontWeight: '600',
  },
  reciterChipTextActive: {
    color: '#080b11',
    fontWeight: '700',
  },
  moreRecitersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#162238',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#2d3d5e',
  },
  moreRecitersText: {
    color: '#9bbfff',
    fontSize: 13,
    fontWeight: '700',
  },
  selectionCard: {
    backgroundColor: '#101522',
    borderRadius: 18,
    padding: 18,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#192235',
  },
  cardLabel: {
    color: '#718096',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  dropdownBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#151c2d',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222b3e',
    marginTop: 10,
    marginBottom: 16,
  },
  dropdownText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  rangeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  rangeSummaryPill: {
    backgroundColor: '#162238',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#24375b',
  },
  rangeSummaryText: {
    color: '#9bbfff',
    fontSize: 12,
    fontWeight: '700',
  },
  quickPresetRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  quickPresetBtn: {
    backgroundColor: '#141c2c',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#202b3f',
  },
  quickPresetBtnActive: {
    backgroundColor: '#1d2a45',
    borderColor: '#9bbfff',
  },
  quickPresetText: {
    color: '#8a95aa',
    fontSize: 12,
    fontWeight: '600',
  },
  quickPresetTextActive: {
    color: '#9bbfff',
    fontWeight: '800',
  },
  embeddedWheelsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  wheelArrowDivider: {
    paddingTop: 24,
    paddingHorizontal: 2,
  },
  playNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0e18',
    borderWidth: 1.5,
    borderColor: '#435882',
    paddingVertical: 18,
    borderRadius: 16,
    marginTop: 22,
    shadowColor: '#9bbfff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  playNowText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
});
