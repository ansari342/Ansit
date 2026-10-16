import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Animated, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Verse } from '../types';
import { colors, space, radius, type } from '../theme';

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
 * The verse as the hero: no card chrome, generous Arabic type, quiet translation.
 * Verse changes cross-fade (180 ms) instead of spring/slide.
 */
export const VerseHero: React.FC<VerseHeroProps> = React.memo(function VerseHero({ verse, verseNumber, words, activeWordIndex, showBismillah, compact = false, hidden = false, onPeekStart, onPeekEnd, onDoubleTap }: VerseHeroProps) {
    const fade = useRef(new Animated.Value(1)).current;
    const scrollRef = useRef<ScrollView>(null);
    const lastTapRef = useRef(0);

    useEffect(() => {
      fade.setValue(0.25);
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, [verseNumber, fade]);

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
          style={styles.wrap}
          onPress={handlePress}
          onLongPress={onPeekStart}
          delayLongPress={240}
          onPressOut={onPeekEnd}
        >
          <Animated.View style={[styles.hiddenBox, { opacity: fade }]}>
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
      <Animated.View style={[styles.wrap, { opacity: fade }]}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, compact && styles.scrollCompact]}
          showsVerticalScrollIndicator={false}
        >
          {showBismillah && !compact && (
            <Text style={styles.bismillah}>بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</Text>
          )}

          <Text style={[styles.arabic, compact && styles.arabicCompact]}>
            {words.length > 0 ? (
              <>
                {words.map((word, index) => {
                  const isCurrent = activeWordIndex === index;
                  const isUpcoming = activeWordIndex >= 0 && index > activeWordIndex;
                  return (
                    <Text
                      key={`${index}_${word}`}
                      style={[styles.word, isCurrent && styles.wordCurrent, isUpcoming && styles.wordUpcoming]}
                    >
                      {word}
                      {index < words.length - 1 ? ' ' : ''}
                    </Text>
                  );
                })}
                <Text style={[styles.ayahMark, activeWordIndex >= words.length && styles.ayahMarkActive]}>
                  {' '}﴿{toArabicIndic(verseNumber)}﴾
                </Text>
              </>
            ) : (
              <Text style={styles.word}>{verse?.arabicText || 'Loading verse…'}</Text>
            )}
          </Text>

          <Text style={[styles.translation, compact && styles.translationCompact]} numberOfLines={compact ? 2 : undefined}>
            {verse?.englishText || 'Loading translation…'}
          </Text>
        </ScrollView>
      </Animated.View>
    );
});

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: space.xl },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: space.lg },
  scrollCompact: { paddingVertical: space.sm },
  bismillah: {
    fontFamily: 'UthmanicHafs',
    fontSize: 22,
    color: colors.gold,
    textAlign: 'center',
    marginBottom: space.lg,
    writingDirection: 'rtl',
  },
  arabic: {
    ...type.arabicVerse,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  arabicCompact: { fontSize: 26, lineHeight: 52 },
  word: { color: colors.text },
  wordCurrent: {
    color: colors.gold,
    textShadowColor: 'rgba(229, 184, 105, 0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  wordUpcoming: { color: 'rgba(255,255,255,0.86)' },
  ayahMark: { color: colors.sapphire, fontSize: 26 },
  ayahMarkActive: { color: colors.gold },
  translation: {
    marginTop: space.xl,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  translationCompact: { marginTop: space.md, fontSize: 13, lineHeight: 19 },

  hiddenBox: {
    flex: 1,
    marginVertical: space.lg,
    borderRadius: radius.surface,
    borderWidth: 1,
    borderColor: colors.goldDeep,
    backgroundColor: colors.surfaceAlt,
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
