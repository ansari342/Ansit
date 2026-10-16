import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Animated, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Verse } from '../types';
import { colors, space, type } from '../theme';

const toArabicIndic = (num: number): string =>
  num
    .toString()
    .split('')
    .map(d => '٠١٢٣٤٥٦٧٨٩'[parseInt(d, 10)] ?? d)
    .join('');

interface VerseHeroProps {
  verse?: Verse;
  verseNumber: number;
  words: string[];
  activeWordIndex: number;
  showBismillah: boolean;
  compact?: boolean;
  /** Hifz Ladder recite step: conceal the text so the user recalls from memory. */
  hidden?: boolean;
  onPeekStart?: () => void;
  onPeekEnd?: () => void;
  onDoubleTap?: () => void;
}

/**
 * Framed Quran card with meditative ambient radial aura, gilded Bismillah banner,
 * glowing word-by-word highlighting, divider, and italic English translation.
 */
export const VerseHero: React.FC<VerseHeroProps> = React.memo(function VerseHero({
  verse,
  verseNumber,
  words,
  activeWordIndex,
  showBismillah,
  compact = false,
  hidden = false,
  onPeekStart,
  onPeekEnd,
  onDoubleTap,
}: VerseHeroProps) {
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const cardScale = useRef(new Animated.Value(1)).current;
  const cardSlideX = useRef(new Animated.Value(0)).current;
  const auraGlow = useRef(new Animated.Value(0.3)).current;
  const scrollRef = useRef<ScrollView>(null);
  const lastTapRef = useRef(0);

  // Meditative ambient breathing glow loop
  useEffect(() => {
    const breathingLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(auraGlow, {
          toValue: 0.65,
          duration: 3200,
          useNativeDriver: true,
        }),
        Animated.timing(auraGlow, {
          toValue: 0.25,
          duration: 3200,
          useNativeDriver: true,
        }),
      ])
    );
    breathingLoop.start();
    return () => breathingLoop.stop();
  }, [auraGlow]);

  // Spring transition when current ayah changes
  useEffect(() => {
    cardOpacity.setValue(0.35);
    cardScale.setValue(0.97);
    cardSlideX.setValue(10);

    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        toValue: 1,
        speed: 24,
        bounciness: 6,
        useNativeDriver: true,
      }),
      Animated.spring(cardSlideX, {
        toValue: 0,
        speed: 24,
        bounciness: 6,
        useNativeDriver: true,
      }),
    ]).start();
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [verseNumber, cardOpacity, cardScale, cardSlideX]);

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 320) {
      lastTapRef.current = 0;
      onDoubleTap?.();
    } else {
      lastTapRef.current = now;
    }
  };

  if (hidden) {
    return (
      <Pressable
        style={[styles.cardWrapper, compact && styles.cardWrapperCompact]}
        onPress={handlePress}
        onLongPress={onPeekStart}
        delayLongPress={240}
        onPressOut={onPeekEnd}
      >
        <Animated.View style={[styles.ambientAura, { opacity: auraGlow }]} />
        <Animated.View
          style={[
            styles.quranCard,
            styles.hiddenBox,
            {
              opacity: cardOpacity,
              transform: [{ scale: cardScale }, { translateX: cardSlideX }],
            },
          ]}
        >
          <View style={styles.hiddenLines}>
            {[0.9, 0.7, 0.8].map((w, i) => (
              <View key={i} style={[styles.hiddenLine, { width: `${w * 100}%` }]} />
            ))}
          </View>
          <Ionicons name="eye-off-outline" size={22} color={colors.goldDeep} style={{ marginTop: space.xxl }} />
          <Text style={styles.hiddenTitle}>Recite from memory</Text>
          <Text style={styles.hiddenHint}>Hold to peek · double-tap to hear it</Text>
          <Text style={styles.hiddenAyah}>﴿{toArabicIndic(verseNumber)}﴾</Text>
        </Animated.View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.cardWrapper, compact && styles.cardWrapperCompact]}>
      {/* Meditative Ambient Radial Aura */}
      <Animated.View
        style={[
          styles.ambientAura,
          {
            opacity: auraGlow,
          },
        ]}
      />

      <Animated.View
        style={[
          styles.quranCard,
          {
            opacity: cardOpacity,
            transform: [{ scale: cardScale }, { translateX: cardSlideX }],
          },
        ]}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.cardScrollContent,
            compact && styles.cardScrollContentCompact,
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Gilded Bismillah Banner */}
          {showBismillah && !compact && (
            <View style={styles.bismillahBox}>
              <Text style={styles.bismillahText}>
                بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
              </Text>
              <View style={styles.bismillahUnderline} />
            </View>
          )}

          {/* Word-By-Word Glowing Highlighting */}
          <Text style={[styles.arabicText, compact && styles.arabicTextCompact]}>
            {words.length > 0 ? (
              <>
                {words.map((word, index) => {
                  const isSpoken = activeWordIndex >= 0 && index < activeWordIndex;
                  const isCurrent = activeWordIndex === index;
                  const isUpcoming = activeWordIndex >= 0 && index > activeWordIndex;

                  return (
                    <Text
                      key={`${index}_${word}`}
                      style={[
                        styles.wordBase,
                        compact && styles.wordBaseCompact,
                        isSpoken && styles.wordSpoken,
                        isCurrent && styles.wordCurrent,
                        isUpcoming && styles.wordUpcoming,
                      ]}
                    >
                      {word}
                      {index < words.length - 1 ? ' ' : ''}
                    </Text>
                  );
                })}
                <Text
                  style={[
                    styles.ayahEndSymbol,
                    compact && styles.ayahEndSymbolCompact,
                    activeWordIndex >= words.length && styles.ayahEndSymbolActive,
                  ]}
                >
                  {' '}
                  ﴿{toArabicIndic(verseNumber)}﴾
                </Text>
              </>
            ) : (
              <Text style={[styles.wordBase, compact && styles.wordBaseCompact]}>
                {verse?.arabicText || 'Loading verse...'}
              </Text>
            )}
          </Text>

          <View style={[styles.cardDivider, compact && styles.cardDividerCompact]} />

          {/* English Translation */}
          <Text
            style={[styles.translationText, compact && styles.translationTextCompact]}
            numberOfLines={compact ? 2 : undefined}
          >
            &quot;{verse?.englishText || 'Loading translation...'}&quot;
          </Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  cardWrapper: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
    justifyContent: 'center',
    position: 'relative',
  },
  cardWrapperCompact: {
    flex: 1,
    paddingVertical: 4,
  },
  ambientAura: {
    position: 'absolute',
    top: 20,
    bottom: 20,
    left: 24,
    right: 24,
    borderRadius: 30,
    backgroundColor: '#1e335a',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 35,
  },
  quranCard: {
    flex: 1,
    backgroundColor: '#121726',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1e283d',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  cardScrollContent: {
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
  },
  cardScrollContentCompact: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bismillahBox: {
    alignItems: 'center',
    marginBottom: 16,
  },
  bismillahText: {
    fontFamily: 'UthmanicHafs',
    fontSize: 22,
    lineHeight: 40,
    color: '#e5b869',
    textAlign: 'center',
    letterSpacing: 0.5,
    writingDirection: 'rtl',
  },
  bismillahUnderline: {
    width: 36,
    height: 1.5,
    backgroundColor: '#a37a34',
    marginTop: 6,
    borderRadius: 1,
  },
  arabicText: {
    fontFamily: 'UthmanicHafs',
    fontSize: 28,
    lineHeight: 56,
    color: '#ffffff',
    textAlign: 'center',
    paddingHorizontal: 6,
    marginBottom: 16,
    writingDirection: 'rtl',
  },
  arabicTextCompact: {
    fontSize: 22,
    lineHeight: 40,
    marginBottom: 6,
  },
  wordBase: {
    fontFamily: 'UthmanicHafs',
    fontSize: 28,
    lineHeight: 56,
    color: '#ffffff',
    textAlign: 'center',
  },
  wordBaseCompact: {
    fontSize: 22,
    lineHeight: 40,
  },
  wordSpoken: {
    color: '#ffffff',
    opacity: 1,
  },
  wordCurrent: {
    color: '#fb923c',
    textShadowColor: 'rgba(249, 115, 22, 0.85)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 11,
    opacity: 1,
  },
  wordUpcoming: {
    color: '#ffffff',
    opacity: 1,
    textShadowRadius: 0,
  },
  ayahEndSymbol: {
    fontFamily: 'UthmanicHafs',
    color: '#9bbfff',
    fontSize: 22,
  },
  ayahEndSymbolCompact: {
    fontSize: 18,
  },
  ayahEndSymbolActive: {
    color: '#fb923c',
    textShadowColor: 'rgba(249, 115, 22, 0.75)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  cardDivider: {
    width: 44,
    height: 2,
    backgroundColor: '#202b42',
    borderRadius: 1,
    marginBottom: 16,
  },
  cardDividerCompact: {
    marginBottom: 6,
  },
  translationText: {
    fontSize: 15,
    lineHeight: 24,
    color: '#cbd5e1',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  translationTextCompact: {
    fontSize: 12.5,
    lineHeight: 18,
  },

  hiddenBox: {
    borderColor: colors.goldDeep,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.xxxl,
  },
  hiddenLines: { width: '70%', gap: 14, alignItems: 'flex-end', opacity: 0.35 },
  hiddenLine: { height: 14, borderRadius: 7, backgroundColor: colors.sapphireDeep },
  hiddenTitle: { ...type.heading, color: colors.gold, marginTop: space.xs },
  hiddenHint: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  hiddenAyah: { fontFamily: 'UthmanicHafs', fontSize: 22, color: colors.textFaint, marginTop: space.lg, writingDirection: 'rtl' },
});
