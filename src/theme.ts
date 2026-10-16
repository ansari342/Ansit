/**
 * Aya design tokens — the single source of truth for color, type, spacing and radii.
 *
 * Semantic color roles:
 *   sapphire  = listening, navigation, primary actions
 *   gold      = the user's own voice / memorization (recite, ladder, pitch)
 *   mint      = success only
 *   danger    = destructive / errors
 */
export const colors = {
  bg: '#080b11',
  bgDeep: '#05070c',
  surface: '#121726',
  surfaceAlt: '#0c1220',
  surfaceRaised: '#151d2d',
  line: '#1e283d',
  lineSoft: '#1a2540',

  text: '#ffffff',
  textBody: '#e6ecf7',
  textMuted: '#8a95aa',
  textFaint: '#52627a',

  sapphire: '#9bbfff',
  sapphireDeep: '#2d446e',
  sapphireTint: '#162136',
  sapphireLine: '#263859',

  gold: '#e5b869',
  goldDeep: '#6b5424',
  goldTint: '#272010',
  goldBright: '#fbbf24',

  mint: '#34d399',
  mintTint: 'rgba(16, 185, 129, 0.16)',
  mintLine: 'rgba(52, 211, 153, 0.45)',

  danger: '#f87171',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  control: 16,
  surface: 24,
  pill: 999,
} as const;

export const type = {
  title: { fontSize: 24, fontWeight: '800' as const, letterSpacing: -0.3, color: colors.text },
  heading: { fontSize: 17, fontWeight: '800' as const, color: colors.text },
  body: { fontSize: 14.5, fontWeight: '600' as const, color: colors.textBody },
  bodyMuted: { fontSize: 13, fontWeight: '500' as const, color: colors.textMuted },
  label: {
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 1.1,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
  },
  caption: { fontSize: 11.5, fontWeight: '600' as const, color: colors.textFaint },
  arabicVerse: { fontFamily: 'UthmanicHafs', fontSize: 34, lineHeight: 72, color: colors.text },
  arabicName: { fontFamily: 'UthmanicHafs', color: colors.text },
} as const;

export const shadow = {
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  glow: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  }),
} as const;

/** One pill style for the whole app; tint it with `tone`. */
export function pill(tone: 'sapphire' | 'gold' | 'mint' | 'neutral' = 'neutral') {
  const map = {
    sapphire: { backgroundColor: colors.sapphireTint, borderColor: colors.sapphireLine, color: colors.sapphire },
    gold: { backgroundColor: colors.goldTint, borderColor: colors.goldDeep, color: colors.gold },
    mint: { backgroundColor: colors.mintTint, borderColor: colors.mintLine, color: colors.mint },
    neutral: { backgroundColor: colors.surfaceRaised, borderColor: colors.line, color: colors.textBody },
  }[tone];
  return {
    container: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
      backgroundColor: map.backgroundColor,
      borderColor: map.borderColor,
    },
    text: { fontSize: 11.5, fontWeight: '700' as const, color: map.color },
    color: map.color,
  };
}
