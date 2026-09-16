import React, { useEffect, useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  getAnalytics,
  getTopSurah,
  getTopSurahsByTime,
  getTopVerse,
  getTopReciter,
  UserAnalytics,
  DEFAULT_ANALYTICS,
} from '../services/analyticsService';
import { SURAHS } from '../data/surahs';
import { BouncyTouchable } from './BouncyTouchable';

const { width } = Dimensions.get('window');

interface AnalyticsModalProps {
  visible: boolean;
  onClose: () => void;
  onPlayTopSession?: (surahNumber: number, fromVerse: number, toVerse: number) => void;
}

export const AnalyticsModal: React.FC<AnalyticsModalProps> = ({
  visible,
  onClose,
  onPlayTopSession,
}) => {
  // Always initialize with safe DEFAULT_ANALYTICS so hooks never mismatch and render never crashes
  const [analytics, setAnalytics] = useState<UserAnalytics>(DEFAULT_ANALYTICS);
  const [selectedSurahNumber, setSelectedSurahNumber] = useState<number>(2);
  const [heatmapMode, setHeatmapMode] = useState<'time' | 'sessions'>('time');

  // 19 columns x 6 rows = 114 Surahs (Unconditional useMemo hook at top level)
  const heatmapColumns = useMemo(() => {
    const cols: (typeof SURAHS)[] = [];
    const rowsPerCol = 6;
    for (let c = 0; c < 19; c++) {
      cols.push(SURAHS.slice(c * rowsPerCol, (c + 1) * rowsPerCol));
    }
    return cols;
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (visible) {
      getAnalytics()
        .then(data => {
          if (isMounted && data) {
            setAnalytics(data);
            const top = getTopSurah(data);
            if (top && top.surah) {
              setSelectedSurahNumber(top.surah.number);
            }
          }
        })
        .catch(err => {
          console.warn('AnalyticsModal load error:', err);
        });
    }
    return () => {
      isMounted = false;
    };
  }, [visible]);

  const topSurah = getTopSurah(analytics);
  const topSurahsByTime = getTopSurahsByTime(analytics, 3);
  const topVerse = getTopVerse(analytics);
  const topReciter = getTopReciter(analytics);

  const formatTime = (totalMinutes: number): string => {
    const mins = Math.max(0, Math.round(totalMinutes || 0));
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours > 0) {
      return `${hours}h ${remMins}m`;
    }
    return `${remMins}m`;
  };

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weeklyMap = analytics?.weeklyMinutes || DEFAULT_ANALYTICS.weeklyMinutes;
  const maxWeeklyMin = Math.max(1, ...Object.values(weeklyMap));

  const surahMinutesMap = analytics?.surahMinutes || DEFAULT_ANALYTICS.surahMinutes;
  const surahCountsMap = analytics?.surahCounts || DEFAULT_ANALYTICS.surahCounts;

  // 114 Surahs GitHub Heatmap coverage calculation
  const distinctSurahsPlayed = Object.keys(surahMinutesMap).filter(
    num => (surahMinutesMap[Number(num)] || 0) > 0 || (surahCountsMap[Number(num)] || 0) > 0
  ).length;
  const quranPercentage = Math.round((distinctSurahsPlayed / 114) * 100);

  const selectedSurah = SURAHS.find(s => s.number === selectedSurahNumber) || SURAHS[1];
  const selectedSurahMinutes = Math.round(surahMinutesMap[selectedSurah.number] || 0);
  const selectedSurahPlays = surahCountsMap[selectedSurah.number] || 0;

  // Color coding by Listening Time (Minutes) vs Sessions
  const getSurahColorByTime = (minutes: number): { bg: string; text: string } => {
    if (minutes <= 0) return { bg: '#131929', text: '#475569' };
    if (minutes < 10) return { bg: '#1e3a68', text: '#cbd5e1' }; // Level 1: 1-9m (Subtle deep blue)
    if (minutes < 25) return { bg: '#2563eb', text: '#ffffff' }; // Level 2: 10-24m (Vibrant royal blue)
    if (minutes < 45) return { bg: '#38bdf8', text: '#080b11' }; // Level 3: 25-44m (Bright cyan sky)
    return { bg: '#9bbfff', text: '#080b11' };                   // Level 4: 45m+ (Glowing sapphire)
  };

  const getSurahColorBySessions = (count: number): { bg: string; text: string } => {
    if (count <= 0) return { bg: '#131929', text: '#475569' };
    if (count <= 2) return { bg: '#1e3a68', text: '#cbd5e1' };
    if (count <= 5) return { bg: '#2563eb', text: '#ffffff' };
    if (count <= 9) return { bg: '#38bdf8', text: '#080b11' };
    return { bg: '#9bbfff', text: '#080b11' };
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Listening Insights</Text>
            <Text style={styles.headerSubtitle}>Aya • Reflection & Memorization</Text>
          </View>
          <TouchableOpacity
            style={styles.closeBtn}
            activeOpacity={0.7}
            onPress={() => {
              try {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              } catch (e) {}
              onClose();
            }}
          >
            <Ionicons name="close" size={22} color="#ffffff" />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* User Profile Card */}
          <View style={styles.userCard}>
            <View style={styles.userAvatarContainer}>
              <View style={styles.userAvatar}>
                <Ionicons name="person" size={26} color="#080b11" />
              </View>
            </View>

            <View style={styles.userInfo}>
              <Text style={styles.userName}>Ahsan Ansari</Text>
              <Text style={styles.userRole}>Qur'an Companion • قَارِئُ الْقُرْآنِ</Text>
              <View style={styles.streakBadge}>
                <Text style={styles.streakIcon}>🔥</Text>
                <Text style={styles.streakText}>
                  {analytics.currentStreakDays || 1} Day Reflection Streak
                </Text>
              </View>
            </View>
          </View>

          {/* 4 Core Stat Tiles */}
          <View style={styles.statsGrid}>
            <View style={styles.statTile}>
              <View style={styles.statIconWrap}>
                <Ionicons name="time-outline" size={20} color="#38bdf8" />
              </View>
              <Text style={styles.statNumber}>{formatTime(analytics.totalMinutes)}</Text>
              <Text style={styles.statLabel}>Total Time</Text>
              <Text style={styles.statSublabel}>Time listened</Text>
            </View>

            <View style={styles.statTile}>
              <View style={styles.statIconWrap}>
                <Ionicons name="headset-outline" size={20} color="#9bbfff" />
              </View>
              <Text style={styles.statNumber}>{analytics.totalSessions}</Text>
              <Text style={styles.statLabel}>Total Listens</Text>
              <Text style={styles.statSublabel}>Sessions</Text>
            </View>

            <View style={styles.statTile}>
              <View style={styles.statIconWrap}>
                <Ionicons name="repeat-outline" size={20} color="#e5b869" />
              </View>
              <Text style={styles.statNumber}>{analytics.totalVersesLooped}</Text>
              <Text style={styles.statLabel}>Verses Looped</Text>
              <Text style={styles.statSublabel}>Ayahs repeated</Text>
            </View>

            <View style={styles.statTile}>
              <View style={styles.statIconWrap}>
                <Ionicons name="mic-outline" size={20} color="#a78bfa" />
              </View>
              <Text style={styles.statNumber} numberOfLines={1}>
                {topReciter?.reciter.shortName || 'Raad'}
              </Text>
              <Text style={styles.statLabel}>Top Reciter</Text>
              <Text style={styles.statSublabel}>{topReciter?.count || 0} sessions</Text>
            </View>
          </View>

          {/* GITHUB-STYLE SURAH HEATMAP (All 114 Surahs Color Coded by Time) */}
          <View style={styles.heatmapCard}>
            <View style={styles.heatmapHeader}>
              <View style={styles.heatmapTitleCol}>
                <View style={styles.heatmapTitleRow}>
                  <Ionicons name="grid" size={13} color="#9bbfff" style={{ marginRight: 6 }} />
                  <Text style={styles.heatmapTitle}>SURAH TIME HEATMAP</Text>
                </View>
                <Text style={styles.heatmapSub}>
                  All 114 Surahs color-coded by {heatmapMode === 'time' ? 'listening time' : 'sessions'}
                </Text>
              </View>

              {/* Mode Toggle: Time vs Sessions */}
              <View style={styles.modeToggleContainer}>
                <TouchableOpacity
                  style={[
                    styles.modeToggleBtn,
                    heatmapMode === 'time' && styles.modeToggleBtnActive,
                  ]}
                  onPress={() => {
                    try {
                      Haptics.selectionAsync();
                    } catch (e) {}
                    setHeatmapMode('time');
                  }}
                >
                  <Text
                    style={[
                      styles.modeToggleText,
                      heatmapMode === 'time' && styles.modeToggleTextActive,
                    ]}
                  >
                    By Time
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modeToggleBtn,
                    heatmapMode === 'sessions' && styles.modeToggleBtnActive,
                  ]}
                  onPress={() => {
                    try {
                      Haptics.selectionAsync();
                    } catch (e) {}
                    setHeatmapMode('sessions');
                  }}
                >
                  <Text
                    style={[
                      styles.modeToggleText,
                      heatmapMode === 'sessions' && styles.modeToggleTextActive,
                    ]}
                  >
                    Sessions
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Quran Coverage Summary Row */}
            <View style={styles.coverageSummaryRow}>
              <Text style={styles.coverageSummaryLabel}>
                {distinctSurahsPlayed} of 114 Surahs Listened
              </Text>
              <Text style={styles.coverageSummaryPercent}>{quranPercentage}% Coverage</Text>
            </View>

            {/* Quran Coverage Progress Bar */}
            <View style={styles.quranProgressBarTrack}>
              <View
                style={[
                  styles.quranProgressBarFill,
                  { width: `${Math.max(4, quranPercentage)}%` },
                ]}
              />
            </View>

            {/* 114 Surahs Grid (19 columns x 6 rows) */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.heatmapScrollContainer}
            >
              <View style={styles.heatmapGrid}>
                {heatmapColumns.map((col, colIdx) => (
                  <View key={colIdx} style={styles.heatmapColumn}>
                    {col.map(surah => {
                      const mins = surahMinutesMap[surah.number] || 0;
                      const count = surahCountsMap[surah.number] || 0;
                      const isSelected = surah.number === selectedSurahNumber;
                      const colors =
                        heatmapMode === 'time'
                          ? getSurahColorByTime(mins)
                          : getSurahColorBySessions(count);

                      return (
                        <TouchableOpacity
                          key={surah.number}
                          activeOpacity={0.65}
                          style={[
                            styles.heatmapCell,
                            { backgroundColor: colors.bg },
                            isSelected && styles.heatmapCellSelected,
                          ]}
                          onPress={() => {
                            try {
                              Haptics.selectionAsync();
                            } catch (e) {}
                            setSelectedSurahNumber(surah.number);
                          }}
                        >
                          <Text style={[styles.heatmapCellNumber, { color: colors.text }]}>
                            {surah.number}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* GitHub-style Activity Legend (Color coded by time) */}
            <View style={styles.legendRow}>
              <Text style={styles.legendLeftText}>Tap any Surah square to inspect</Text>
              <View style={styles.legendRight}>
                <Text style={styles.legendText}>{heatmapMode === 'time' ? '0m' : '0'}</Text>
                <View style={[styles.legendCell, { backgroundColor: '#131929' }]} />
                <View style={[styles.legendCell, { backgroundColor: '#1e3a68' }]} />
                <View style={[styles.legendCell, { backgroundColor: '#2563eb' }]} />
                <View style={[styles.legendCell, { backgroundColor: '#38bdf8' }]} />
                <View style={[styles.legendCell, { backgroundColor: '#9bbfff' }]} />
                <Text style={styles.legendText}>
                  {heatmapMode === 'time' ? '45m+' : '10+'}
                </Text>
              </View>
            </View>

            {/* Selected Surah Interactive Inspection Card */}
            {selectedSurah && (
              <View style={styles.inspectionCard}>
                <View style={styles.inspectionTop}>
                  <View style={styles.inspectionNumBadge}>
                    <Text style={styles.inspectionNumText}>#{selectedSurah.number}</Text>
                  </View>

                  <View style={styles.inspectionTitles}>
                    <Text style={styles.inspectionEnglishName} numberOfLines={1}>
                      Surah {selectedSurah.englishName}
                    </Text>
                    <Text style={styles.inspectionMeta}>
                      {selectedSurah.numberOfAyahs} Verses • {selectedSurah.revelationType}
                    </Text>
                  </View>

                  <Text style={styles.inspectionArabicName}>
                    {selectedSurah.name}
                  </Text>
                </View>

                <View style={styles.inspectionBottom}>
                  <View style={styles.inspectionStatsRow}>
                    {/* Time Listened Badge */}
                    <View style={styles.timePill}>
                      <Ionicons
                        name="time"
                        size={13}
                        color={selectedSurahMinutes > 0 ? '#38bdf8' : '#64748b'}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[
                          styles.timePillText,
                          selectedSurahMinutes === 0 && { color: '#64748b' },
                        ]}
                      >
                        {selectedSurahMinutes > 0
                          ? `${formatTime(selectedSurahMinutes)} listened`
                          : '0m listened'}
                      </Text>
                    </View>

                    {/* Sessions Count Badge */}
                    <View style={styles.sessionPill}>
                      <Ionicons
                        name="headset-outline"
                        size={12}
                        color="#94a3b8"
                        style={{ marginRight: 4 }}
                      />
                      <Text style={styles.sessionPillText}>
                        {selectedSurahPlays} {selectedSurahPlays === 1 ? 'session' : 'sessions'}
                      </Text>
                    </View>
                  </View>

                  {onPlayTopSession && (
                    <BouncyTouchable
                      style={styles.inspectionPlayBtn}
                      onPress={() => {
                        onClose();
                        onPlayTopSession(selectedSurah.number, 1, selectedSurah.numberOfAyahs);
                      }}
                    >
                      <Ionicons name="play" size={11} color="#080b11" style={{ marginRight: 4 }} />
                      <Text style={styles.inspectionPlayBtnText}>Loop Surah</Text>
                    </BouncyTouchable>
                  )}
                </View>
              </View>
            )}

            {/* Top Surahs Ranked by Listening Time */}
            {topSurahsByTime.length > 0 && (
              <View style={styles.topTimeSection}>
                <Text style={styles.topTimeSectionTitle}>MOST LISTENED BY TIME</Text>
                {topSurahsByTime.map((item, idx) => {
                  const maxMins = topSurahsByTime[0]?.minutes || 1;
                  const pct = Math.max(12, Math.round((item.minutes / maxMins) * 100));
                  return (
                    <TouchableOpacity
                      key={item.surah.number}
                      activeOpacity={0.75}
                      style={styles.topTimeRow}
                      onPress={() => {
                        try {
                          Haptics.selectionAsync();
                        } catch (e) {}
                        setSelectedSurahNumber(item.surah.number);
                      }}
                    >
                      <View style={styles.topTimeRankBadge}>
                        <Text style={styles.topTimeRankText}>#{idx + 1}</Text>
                      </View>
                      <View style={styles.topTimeInfo}>
                        <View style={styles.topTimeNameRow}>
                          <Text style={styles.topTimeSurahName}>
                            Surah {item.surah.englishName}
                          </Text>
                          <Text style={styles.topTimeDurationText}>
                            {formatTime(item.minutes)} ({item.count} sessions)
                          </Text>
                        </View>
                        <View style={styles.topTimeBarTrack}>
                          <View
                            style={[
                              styles.topTimeBarFill,
                              {
                                width: `${pct}%`,
                                backgroundColor:
                                  idx === 0 ? '#9bbfff' : idx === 1 ? '#38bdf8' : '#2563eb',
                              },
                            ]}
                          />
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {/* HIGHLIGHT 1: Most Listened Verse */}
          {topVerse && (
            <View style={styles.highlightCard}>
              <View style={styles.highlightHeader}>
                <View style={styles.highlightBadge}>
                  <Ionicons name="sparkles" size={12} color="#9bbfff" style={{ marginRight: 4 }} />
                  <Text style={styles.highlightBadgeText}>MOST REPEATED AYAH</Text>
                </View>
                <Text style={styles.highlightCountBadge}>
                  {topVerse.count} times
                </Text>
              </View>

              <Text style={styles.highlightAyahTitle}>
                Surah {topVerse.surah.englishName} • Ayah {topVerse.verseNumber}
              </Text>

              {/* Arabic Calligraphy Snippet */}
              <View style={styles.arabicSnippetBox}>
                <Text style={styles.arabicSnippetText}>
                  {topVerse.surah.number === 67 && topVerse.verseNumber === 1
                    ? 'تَبَارَكَ الَّذِي بِيَدِهِ الْمُلْكُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ'
                    : topVerse.surah.number === 1 && topVerse.verseNumber === 1
                    ? 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ'
                    : 'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ'}
                </Text>
              </View>

              <Text style={styles.highlightDescription}>
                You looped this verse the most during your memorization & contemplation sessions.
              </Text>

              {onPlayTopSession && (
                <BouncyTouchable
                  style={styles.playHighlightBtn}
                  onPress={() => {
                    onClose();
                    onPlayTopSession(topVerse.surah.number, topVerse.verseNumber, topVerse.verseNumber);
                  }}
                >
                  <Ionicons name="play" size={14} color="#080b11" style={{ marginRight: 6 }} />
                  <Text style={styles.playHighlightBtnText}>Loop This Ayah Now</Text>
                </BouncyTouchable>
              )}
            </View>
          )}

          {/* Weekly Reflection Activity Bar Chart */}
          <View style={styles.chartCard}>
            <View style={styles.chartHeader}>
              <Text style={styles.chartTitle}>WEEKLY REFLECTION TIME</Text>
              <Text style={styles.chartSub}>Minutes per day</Text>
            </View>

            <View style={styles.barsContainer}>
              {days.map(day => {
                const mins = weeklyMap[day] || 0;
                const barHeight = Math.max(8, (mins / maxWeeklyMin) * 80);
                const isToday = day === days[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];

                return (
                  <View key={day} style={styles.barColumn}>
                    <Text style={styles.barValueText}>{mins > 0 ? `${mins}m` : '-'}</Text>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          { height: barHeight },
                          isToday && styles.barFillActive,
                        ]}
                      />
                    </View>
                    <Text style={[styles.barDayText, isToday && styles.barDayTextActive]}>
                      {day}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Spiritual Reflection Inscription */}
          <View style={styles.spiritualCard}>
            <Text style={styles.spiritualArabic}>
              أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ
            </Text>
            <Text style={styles.spiritualEnglish}>
              "Verily, in the remembrance of Allah do hearts find rest."
            </Text>
            <Text style={styles.spiritualRef}>Surah Ar-Ra'd • 13:28</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#080b11',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#151c2c',
  },
  headerLeft: {
    flexDirection: 'column',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    color: '#9bbfff',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#131929',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 48,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#101624',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 16,
  },
  userAvatarContainer: {
    marginRight: 16,
  },
  userAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#9bbfff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#9bbfff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  userRole: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
    marginBottom: 8,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(229, 184, 105, 0.14)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(229, 184, 105, 0.35)',
  },
  streakIcon: {
    fontSize: 12,
    marginRight: 5,
  },
  streakText: {
    color: '#e5b869',
    fontSize: 12,
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statTile: {
    width: (width - 48) / 2,
    backgroundColor: '#101624',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#161f33',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statNumber: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  statLabel: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  statSublabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  heatmapCard: {
    backgroundColor: '#101624',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 16,
  },
  heatmapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  heatmapTitleCol: {
    flex: 1,
    marginRight: 8,
  },
  heatmapTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heatmapTitle: {
    color: '#9bbfff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  heatmapSub: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 3,
  },
  modeToggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#0b0f19',
    borderRadius: 10,
    padding: 2,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  modeToggleBtn: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  modeToggleBtnActive: {
    backgroundColor: '#1e3a68',
  },
  modeToggleText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
  },
  modeToggleTextActive: {
    color: '#9bbfff',
  },
  coverageSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  coverageSummaryLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  coverageSummaryPercent: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
  quranProgressBarTrack: {
    height: 6,
    backgroundColor: '#161f33',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 14,
  },
  quranProgressBarFill: {
    height: '100%',
    backgroundColor: '#38bdf8',
    borderRadius: 3,
  },
  heatmapScrollContainer: {
    paddingVertical: 4,
  },
  heatmapGrid: {
    flexDirection: 'row',
    gap: 5,
  },
  heatmapColumn: {
    flexDirection: 'column',
    gap: 5,
  },
  heatmapCell: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  heatmapCellSelected: {
    borderWidth: 2,
    borderColor: '#ffffff',
    transform: [{ scale: 1.08 }],
  },
  heatmapCellNumber: {
    fontSize: 9,
    fontWeight: '800',
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#161f33',
  },
  legendLeftText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '500',
  },
  legendRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendCell: {
    width: 11,
    height: 11,
    borderRadius: 3,
  },
  legendText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    marginHorizontal: 2,
  },
  inspectionCard: {
    marginTop: 14,
    backgroundColor: '#151d30',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#263554',
  },
  inspectionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  inspectionNumBadge: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    marginRight: 10,
  },
  inspectionNumText: {
    color: '#9bbfff',
    fontSize: 12,
    fontWeight: '800',
  },
  inspectionTitles: {
    flex: 1,
  },
  inspectionEnglishName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  inspectionMeta: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  inspectionArabicName: {
    color: '#9bbfff',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  inspectionBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  inspectionStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    flexWrap: 'wrap',
  },
  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  timePillText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
  sessionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  sessionPillText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600',
  },
  inspectionPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#9bbfff',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    marginLeft: 8,
  },
  inspectionPlayBtnText: {
    color: '#080b11',
    fontSize: 12,
    fontWeight: '800',
  },
  topTimeSection: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#161f33',
  },
  topTimeSectionTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  topTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  topTimeRankBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#161f33',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  topTimeRankText: {
    color: '#9bbfff',
    fontSize: 11,
    fontWeight: '800',
  },
  topTimeInfo: {
    flex: 1,
  },
  topTimeNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  topTimeSurahName: {
    color: '#f1f5f9',
    fontSize: 13,
    fontWeight: '700',
  },
  topTimeDurationText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
  topTimeBarTrack: {
    height: 5,
    backgroundColor: '#161f33',
    borderRadius: 3,
    overflow: 'hidden',
  },
  topTimeBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  highlightCard: {
    backgroundColor: '#101624',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 16,
  },
  highlightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  highlightBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(155, 191, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  highlightBadgeText: {
    color: '#9bbfff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  highlightCountBadge: {
    color: '#e5b869',
    fontSize: 13,
    fontWeight: '800',
  },
  highlightAyahTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 10,
  },
  arabicSnippetBox: {
    backgroundColor: '#0b0f19',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 10,
  },
  arabicSnippetText: {
    color: '#f8fafc',
    fontSize: 20,
    textAlign: 'center',
    lineHeight: 34,
    fontWeight: '600',
  },
  highlightDescription: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  playHighlightBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9bbfff',
    paddingVertical: 12,
    borderRadius: 12,
  },
  playHighlightBtnText: {
    color: '#080b11',
    fontSize: 14,
    fontWeight: '800',
  },
  chartCard: {
    backgroundColor: '#101624',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 16,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  chartTitle: {
    color: '#9bbfff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  chartSub: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },
  barsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 120,
    paddingTop: 16,
  },
  barColumn: {
    alignItems: 'center',
    flex: 1,
  },
  barValueText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 6,
  },
  barTrack: {
    width: 14,
    height: 80,
    backgroundColor: '#161f33',
    borderRadius: 7,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 7,
  },
  barFillActive: {
    backgroundColor: '#9bbfff',
  },
  barDayText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
  },
  barDayTextActive: {
    color: '#ffffff',
  },
  spiritualCard: {
    backgroundColor: '#0b0f19',
    borderRadius: 18,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#161f33',
  },
  spiritualArabic: {
    color: '#9bbfff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  spiritualEnglish: {
    color: '#cbd5e1',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: 4,
  },
  spiritualRef: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
});
