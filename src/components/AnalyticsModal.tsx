import React, { useEffect, useState } from 'react';
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  getAnalytics,
  getTopSurah,
  getTopVerse,
  getTopReciter,
  UserAnalytics,
} from '../services/analyticsService';
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
  const [analytics, setAnalytics] = useState<UserAnalytics | null>(null);

  useEffect(() => {
    if (visible) {
      getAnalytics().then(setAnalytics);
    }
  }, [visible]);

  if (!analytics) return null;

  const topSurah = getTopSurah(analytics);
  const topVerse = getTopVerse(analytics);
  const topReciter = getTopReciter(analytics);

  const formatTime = (totalMinutes: number): string => {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const maxWeeklyMin = Math.max(1, ...Object.values(analytics.weeklyMinutes));

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
            <Text style={styles.headerSubtitleArabic}>الإِحْصَائِيَّاتُ وَالتَّدَبُّرُ</Text>
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
                  {analytics.currentStreakDays} Day Reflection Streak
                </Text>
              </View>
            </View>
          </View>

          {/* 4 Core Stat Tiles */}
          <View style={styles.statsGrid}>
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
                <Ionicons name="time-outline" size={20} color="#38bdf8" />
              </View>
              <Text style={styles.statNumber}>{formatTime(analytics.totalMinutes)}</Text>
              <Text style={styles.statLabel}>Reflection Time</Text>
              <Text style={styles.statSublabel}>Time listened</Text>
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

          {/* HIGHLIGHT 2: Favorite Surah */}
          {topSurah && (
            <View style={styles.highlightCard}>
              <View style={styles.highlightHeader}>
                <View style={styles.highlightBadge}>
                  <Ionicons name="book-outline" size={12} color="#9bbfff" style={{ marginRight: 4 }} />
                  <Text style={styles.highlightBadgeText}>FAVORITE SURAH</Text>
                </View>
                <Text style={styles.highlightArabicTitle}>
                  {topSurah.surah.name}
                </Text>
              </View>

              <View style={styles.surahHighlightRow}>
                <View>
                  <Text style={styles.surahHighlightName}>
                    Surah {topSurah.surah.englishName}
                  </Text>
                  <Text style={styles.surahHighlightSub}>
                    {topSurah.surah.numberOfAyahs} Verses • {topSurah.surah.revelationType}
                  </Text>
                </View>

                <View style={styles.surahPlayBadge}>
                  <Text style={styles.surahPlayCount}>{topSurah.count}</Text>
                  <Text style={styles.surahPlayLabel}>Listens</Text>
                </View>
              </View>
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
                const mins = analytics.weeklyMinutes[day] || 0;
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
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#141d2f',
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitleArabic: {
    color: '#9bbfff',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#151f33',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#243452',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0e1626',
    borderRadius: 20,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#1d2c47',
  },
  userAvatarContainer: {
    marginRight: 16,
  },
  userAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#9bbfff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#9bbfff',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  userRole: {
    color: '#8a95aa',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#182438',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#2b3f63',
  },
  streakIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  streakText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  statTile: {
    width: (width - 40 - 12) / 2,
    backgroundColor: '#0c1220',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#19243a',
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#131b2e',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statNumber: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  statLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  statSublabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  highlightCard: {
    backgroundColor: '#0d1526',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1.2,
    borderColor: '#1e2e4c',
  },
  highlightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  highlightBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#142036',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#24375b',
  },
  highlightBadgeText: {
    color: '#9bbfff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  highlightCountBadge: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
  highlightArabicTitle: {
    color: '#9bbfff',
    fontSize: 18,
    fontWeight: '700',
  },
  highlightAyahTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 10,
  },
  arabicSnippetBox: {
    backgroundColor: '#090d17',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#172236',
  },
  arabicSnippetText: {
    color: '#e2e8f0',
    fontSize: 17,
    lineHeight: 28,
    textAlign: 'right',
    fontWeight: '600',
  },
  highlightDescription: {
    color: '#8a95aa',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 14,
  },
  playHighlightBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9bbfff',
    paddingVertical: 10,
    borderRadius: 12,
  },
  playHighlightBtnText: {
    color: '#080b11',
    fontSize: 13,
    fontWeight: '800',
  },
  surahHighlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  surahHighlightName: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 3,
  },
  surahHighlightSub: {
    color: '#8a95aa',
    fontSize: 12,
    fontWeight: '500',
  },
  surahPlayBadge: {
    backgroundColor: '#131e33',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#24375b',
  },
  surahPlayCount: {
    color: '#38bdf8',
    fontSize: 18,
    fontWeight: '800',
  },
  surahPlayLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '600',
  },
  chartCard: {
    backgroundColor: '#0d1526',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1a2740',
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  chartTitle: {
    color: '#8a95aa',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  chartSub: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '500',
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 120,
    paddingHorizontal: 4,
  },
  barColumn: {
    alignItems: 'center',
    flex: 1,
  },
  barValueText: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '600',
    marginBottom: 4,
  },
  barTrack: {
    width: 14,
    height: 80,
    backgroundColor: '#121a2d',
    borderRadius: 7,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    backgroundColor: '#1e3860',
    borderRadius: 7,
  },
  barFillActive: {
    backgroundColor: '#38bdf8',
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  barDayText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 8,
  },
  barDayTextActive: {
    color: '#9bbfff',
    fontWeight: '800',
  },
  spiritualCard: {
    backgroundColor: '#0c1220',
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#19243a',
    marginTop: 4,
  },
  spiritualArabic: {
    color: '#9bbfff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: 1,
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
