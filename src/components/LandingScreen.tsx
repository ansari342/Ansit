import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated,
  PanResponder,
  StatusBar,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DeviceMotion } from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import { HistoryItem } from '../services/historyService';
import { SURAHS } from '../data/surahs';

const { height, width } = Dimensions.get('window');

interface LandingScreenProps {
  onEnter: () => void;
  recentItem?: HistoryItem | null;
  onPlayRecent?: (item: HistoryItem) => void;
}

export const LandingScreen: React.FC<LandingScreenProps> = ({
  onEnter,
  recentItem,
  onPlayRecent,
}) => {
  // Recently Played / Quick-Start Suggestion
  const hasRealRecent = Boolean(recentItem);
  const suggestionItem: HistoryItem = recentItem || {
    id: 'default_fatiha',
    surahNumber: 1,
    surahName: 'Al-Fatihah',
    fromVerse: 1,
    toVerse: 7,
    reciterId: 'raad_al_kurdi',
    reciterName: 'Sheikh Raad Al-Kurdi',
    timestamp: Date.now(),
  };

  const suggestionSurah = SURAHS.find(s => s.number === suggestionItem.surahNumber);

  const handlePlaySuggestion = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {}
    if (onPlayRecent) {
      onPlayRecent(suggestionItem);
    } else {
      onEnter();
    }
  };

  // Swipe up translateY
  const translateY = useRef(new Animated.Value(0)).current;

  // Delightful looping ambient animations
  const pulse1 = useRef(new Animated.Value(0.4)).current;
  const pulse2 = useRef(new Animated.Value(0.3)).current;
  const chevronBounce = useRef(new Animated.Value(0)).current;
  const titleFade = useRef(new Animated.Value(0)).current;
  const titleScale = useRef(new Animated.Value(0.92)).current;

  // Device motion parallax values (gyroscope tilt)
  const motionX = useRef(new Animated.Value(0)).current;
  const motionY = useRef(new Animated.Value(0)).current;

  // 1. Mount entrance animation
  useEffect(() => {
    Animated.parallel([
      Animated.timing(titleFade, {
        toValue: 1,
        duration: 850,
        useNativeDriver: true,
      }),
      Animated.spring(titleScale, {
        toValue: 1,
        friction: 7,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, [titleFade, titleScale]);

  // 2. Continuous Gemini-style breathing nebula aura
  useEffect(() => {
    const loop1 = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse1, {
          toValue: 0.75,
          duration: 3200,
          useNativeDriver: true,
        }),
        Animated.timing(pulse1, {
          toValue: 0.4,
          duration: 3200,
          useNativeDriver: true,
        }),
      ])
    );

    const loop2 = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse2, {
          toValue: 0.65,
          duration: 2600,
          useNativeDriver: true,
        }),
        Animated.timing(pulse2, {
          toValue: 0.25,
          duration: 2600,
          useNativeDriver: true,
        }),
      ])
    );

    const chevronLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(chevronBounce, {
          toValue: -8,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(chevronBounce, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );

    loop1.start();
    loop2.start();
    chevronLoop.start();

    return () => {
      loop1.stop();
      loop2.stop();
      chevronLoop.stop();
    };
  }, [pulse1, pulse2, chevronBounce]);

  // 3. Device motion parallax effect (gyroscope tilt)
  useEffect(() => {
    let subscription: any = null;
    let isMounted = true;

    DeviceMotion.isAvailableAsync()
      .then(available => {
        if (!isMounted || !available) return;
        DeviceMotion.setUpdateInterval(32); // ~30 fps liquid smooth
        subscription = DeviceMotion.addListener(data => {
          if (data.rotation) {
            const gamma = data.rotation.gamma ?? 0;
            const beta = data.rotation.beta ?? 0;

            const normalizedX = Math.max(-1, Math.min(1, gamma * 1.5));
            const normalizedY = Math.max(-1, Math.min(1, (beta - 0.7) * 1.5));

            Animated.spring(motionX, {
              toValue: normalizedX,
              friction: 8,
              tension: 40,
              useNativeDriver: true,
            }).start();

            Animated.spring(motionY, {
              toValue: normalizedY,
              friction: 8,
              tension: 40,
              useNativeDriver: true,
            }).start();
          }
        });
      })
      .catch(() => {});

    return () => {
      isMounted = false;
      subscription?.remove();
    };
  }, [motionX, motionY]);

  const triggerDismiss = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {}

    Animated.timing(translateY, {
      toValue: -height,
      duration: 320,
      useNativeDriver: true,
    }).start(() => {
      onEnter();
    });
  };

  // 3. PanResponder for physical swipe-up gesture
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 10;
      },
      onPanResponderMove: (_, gestureState) => {
        // Only allow upward swiping
        if (gestureState.dy < 0) {
          translateY.setValue(gestureState.dy);
        } else {
          // Add resistance if dragging downwards
          translateY.setValue(gestureState.dy * 0.15);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        // If dragged up by more than 100px or swiped with upward flick velocity
        if (gestureState.dy < -90 || gestureState.vy < -0.6) {
          triggerDismiss();
        } else {
          // Snap back down gracefully
          Animated.spring(translateY, {
            toValue: 0,
            friction: 8,
            tension: 50,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  // Interpolate opacity as user drags up
  const containerOpacity = translateY.interpolate({
    inputRange: [-height * 0.6, 0],
    outputRange: [0.15, 1],
    extrapolate: 'clamp',
  });

  // Interpolate scale slightly when dragging
  const containerScale = translateY.interpolate({
    inputRange: [-height * 0.5, 0],
    outputRange: [0.95, 1],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: containerOpacity,
          transform: [{ translateY }, { scale: containerScale }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      <StatusBar barStyle="light-content" backgroundColor="#050811" />

      {/* Gemini-Style Ambient Breathing Nebulas */}
      <View style={styles.ambientBackground} pointerEvents="none">
        {/* Top-center sapphire aura */}
        <Animated.View
          style={[
            styles.nebulaOrb,
            styles.nebulaBlue,
            {
              opacity: pulse1,
              transform: [
                {
                  scale: pulse1.interpolate({
                    inputRange: [0.4, 0.75],
                    outputRange: [0.95, 1.25],
                  }),
                },
                {
                  translateX: motionX.interpolate({
                    inputRange: [-1, 1],
                    outputRange: [36, -36],
                  }),
                },
                {
                  translateY: motionY.interpolate({
                    inputRange: [-1, 1],
                    outputRange: [36, -36],
                  }),
                },
              ],
            },
          ]}
        />

        {/* Center cyan glow */}
        <Animated.View
          style={[
            styles.nebulaOrb,
            styles.nebulaCyan,
            {
              opacity: pulse2,
              transform: [
                {
                  scale: pulse2.interpolate({
                    inputRange: [0.25, 0.65],
                    outputRange: [1.15, 0.9],
                  }),
                },
                {
                  translateX: motionX.interpolate({
                    inputRange: [-1, 1],
                    outputRange: [-24, 24],
                  }),
                },
                {
                  translateY: motionY.interpolate({
                    inputRange: [-1, 1],
                    outputRange: [-24, 24],
                  }),
                },
              ],
            },
          ]}
        />
      </View>

      {/* Content Container (Anchored & Static) */}
      <Animated.View
        style={[
          styles.contentWrapper,
          {
            opacity: titleFade,
            transform: [{ scale: titleScale }],
          },
        ]}
      >
        {/* Main Title Card */}
        <Text style={styles.mainTitle}>Ansit</Text>

        {/* Quranic Ayah Referencing Ansit in Blue */}
        <Text style={styles.arabicAyahQuote}>
          وَأَنْصِتُوا لَعَلَّكُمْ تُرْحَمُونَ
        </Text>

        {/* Minimalist Tagline */}
        <Text style={styles.tagline}>Custom Quran Recitation</Text>

        {/* Suggestion Card for Most Recently Played */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.suggestionCard}
          onPress={handlePlaySuggestion}
        >
          {/* Top row: badge & Arabic Surah */}
          <View style={styles.suggestionTopRow}>
            <View style={styles.suggestionBadge}>
              <Ionicons name="sparkles" size={10} color="#9bbfff" style={{ marginRight: 4 }} />
              <Text style={styles.suggestionBadgeText}>
                {hasRealRecent ? 'RECENTLY PLAYED' : 'QUICK START'}
              </Text>
            </View>

            <Text style={styles.suggestionArabicSurah}>
              {suggestionSurah?.name || 'سُورَةُ الفَاتِحَةِ'}
            </Text>
          </View>

          {/* Main info row */}
          <View style={styles.suggestionMainRow}>
            <View style={styles.suggestionInfo}>
              <Text style={styles.suggestionTitle} numberOfLines={1}>
                Surah {suggestionItem.surahName}
              </Text>
              <Text style={styles.suggestionSubtitle} numberOfLines={1}>
                {suggestionItem.fromVerse}–{suggestionItem.toVerse} • {suggestionItem.reciterName}
              </Text>
            </View>

            <View style={styles.suggestionPlayBtn}>
              <Ionicons name="play" size={17} color="#080b11" style={{ marginLeft: 2 }} />
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>

      {/* Bottom Floating "Swipe up to begin" Pill */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={triggerDismiss}
        style={styles.bottomPromptContainer}
      >
        <Animated.View
          style={[
            styles.chevronWrap,
            {
              transform: [{ translateY: chevronBounce }],
            },
          ]}
        >
          <Ionicons name="chevron-up" size={26} color="#9bbfff" />
        </Animated.View>

        <View style={styles.swipePill}>
          <Text style={styles.swipePillText}>SWIPE UP TO BEGIN</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#050811',
    zIndex: 9999,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: height * 0.08,
  },
  ambientBackground: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  nebulaOrb: {
    position: 'absolute',
    borderRadius: 300,
  },
  nebulaBlue: {
    width: width * 0.95,
    height: width * 0.95,
    backgroundColor: '#1d3557',
    top: height * 0.18,
    borderRadius: (width * 0.95) / 2,
    opacity: 0.5,
    shadowColor: '#2b5288',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 80,
  },
  nebulaCyan: {
    width: width * 0.75,
    height: width * 0.75,
    backgroundColor: '#0f2744',
    bottom: height * 0.25,
    borderRadius: (width * 0.75) / 2,
    opacity: 0.4,
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 90,
  },
  contentWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: height * 0.10,
    paddingHorizontal: 24,
  },
  mainTitle: {
    fontSize: 48,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -1,
    textAlign: 'center',
    marginBottom: 4,
    textShadowColor: 'rgba(155, 191, 255, 0.4)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 20,
  },
  arabicAyahQuote: {
    fontSize: 22,
    color: '#9bbfff',
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 1.2,
    marginBottom: 6,
    textShadowColor: 'rgba(155, 191, 255, 0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 14,
  },
  tagline: {
    fontSize: 15,
    color: '#94a3b8',
    fontWeight: '500',
    textAlign: 'center',
    letterSpacing: 0.6,
    lineHeight: 22,
  },
  suggestionCard: {
    width: Math.min(width - 56, 324),
    backgroundColor: 'rgba(14, 22, 38, 0.85)',
    borderRadius: 18,
    padding: 14,
    marginTop: 22,
    borderWidth: 1.2,
    borderColor: 'rgba(155, 191, 255, 0.28)',
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 5,
  },
  suggestionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  suggestionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(155, 191, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(155, 191, 255, 0.22)',
  },
  suggestionBadgeText: {
    color: '#9bbfff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  suggestionArabicSurah: {
    color: '#9bbfff',
    fontSize: 15,
    fontWeight: '700',
  },
  suggestionMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  suggestionInfo: {
    flex: 1,
    paddingRight: 10,
  },
  suggestionTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  suggestionSubtitle: {
    color: '#8a95aa',
    fontSize: 12,
    fontWeight: '500',
  },
  suggestionPlayBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#9bbfff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#9bbfff',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
  },
  bottomPromptContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  chevronWrap: {
    marginBottom: 6,
  },
  swipePill: {
    backgroundColor: '#0e1626',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1d2d47',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  swipePillText: {
    color: '#9bbfff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
});
