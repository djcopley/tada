import type { TextStyle, ViewStyle } from 'react-native'

/**
 * "Dispatch" design tokens. Chrome is neutral ink-and-bone; the four signal
 * colors are the only saturated colors in the app and always carry status
 * meaning (amber = waiting, green = running/success, violet = needs review,
 * red = failed/destructive). See docs/superpowers/specs/2026-08-14-dispatch-design-system.md.
 */

export type Palette = {
  bg: string
  surface: string
  surfaceAlt: string
  ink: string
  inkMuted: string
  inkFaint: string
  line: string
  signalAmber: string
  signalAmberBg: string
  signalGreen: string
  signalGreenBg: string
  signalViolet: string
  signalVioletBg: string
  signalRed: string
  signalRedBg: string
  scrim: string
  /** Text/icon color drawn on top of an `ink`-filled control. */
  onInk: string
}

export const light: Palette = {
  bg: '#F2F1EC',
  surface: '#FFFFFF',
  surfaceAlt: '#E9E7E0',
  ink: '#16202E',
  inkMuted: '#5B6572',
  inkFaint: '#9AA1AA',
  line: '#D8D5CD',
  signalAmber: '#B97700',
  signalAmberBg: '#F6ECD9',
  signalGreen: '#20803F',
  signalGreenBg: '#E1EFE4',
  signalViolet: '#6D4FC4',
  signalVioletBg: '#EAE5F7',
  signalRed: '#B3372F',
  signalRedBg: '#F7E4E2',
  scrim: 'rgba(16,22,31,0.45)',
  onInk: '#F2F1EC',
}

export const dark: Palette = {
  bg: '#10161F',
  surface: '#1A2230',
  surfaceAlt: '#141B26',
  ink: '#E8E6E1',
  inkMuted: '#98A2AE',
  inkFaint: '#5B6572',
  line: '#2A3342',
  signalAmber: '#E0A030',
  signalAmberBg: '#2B2414',
  signalGreen: '#4CAF6E',
  signalGreenBg: '#15281C',
  signalViolet: '#9B84E8',
  signalVioletBg: '#241E38',
  signalRed: '#E06055',
  signalRedBg: '#331A18',
  scrim: 'rgba(16,22,31,0.45)',
  onInk: '#10161F',
}

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const

export const radius = {
  sm: 4,
  md: 10,
  lg: 16,
  full: 999,
} as const

export const fonts = {
  ui: 'Barlow_400Regular',
  uiMedium: 'Barlow_500Medium',
  uiSemiBold: 'Barlow_600SemiBold',
  display: 'BarlowSemiCondensed_600SemiBold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
} as const

export const type = {
  display: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  body: {
    fontFamily: fonts.ui,
    fontSize: 15,
    lineHeight: 21,
  },
  bodyStrong: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 15,
    lineHeight: 21,
  },
  caption: {
    fontFamily: fonts.uiMedium,
    fontSize: 12,
    lineHeight: 16,
  },
  mono: {
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 18,
  },
  monoSmall: {
    fontFamily: fonts.monoMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.8,
  },
} satisfies Record<string, TextStyle>

export const motion = {
  fast: 120,
  base: 200,
  slow: 320,
} as const

/** Soft ink-tinted card shadow; `lifted` is the stronger drag state. */
export function shadows(palette: Palette): { card: ViewStyle; lifted: ViewStyle } {
  return {
    card: {
      shadowColor: palette === dark ? '#000000' : light.ink,
      shadowOpacity: 0.1,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    lifted: {
      shadowColor: palette === dark ? '#000000' : light.ink,
      shadowOpacity: 0.22,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
  }
}
