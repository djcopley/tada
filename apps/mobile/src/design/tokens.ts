import type { TextStyle, ViewStyle } from 'react-native'

/**
 * "Instrument Ink" design tokens. Night watch (warm brown-black ink) is the
 * primary theme; paper day is the opt-in light theme. Two voices share every
 * screen: the agent speaks IBM Plex Mono from recessed dark ink (the agent*
 * tokens are theme-invariant), you speak Instrument Sans on raised surfaces.
 * Orange = live, sage = accepted/ok, red only for failure — no other
 * decorative color exists.
 */

export type Palette = {
  /** Screen background (ink-900 / paper-100). */
  ground: string
  /** Cards and other raised surfaces. */
  raised: string
  /** A second step of raise: pressed rows, chips, lanes. */
  raised2: string
  /** Recessed wells (segmented controls, transcript panels). */
  recessed: string
  /** Floating menus and sheets. */
  overlay: string
  text: string
  textMuted: string
  textFaint: string
  textFaintSolid: string
  textInverse: string
  borderSubtle: string
  borderStrong: string
  scrim: string
  /** Orange — an agent is live right now. */
  live: string
  liveText: string
  liveSoft: string
  /** Sage — accepted, ok, your turn. */
  ok: string
  okText: string
  okSoft: string
  /** Red — failure only. */
  fail: string
  failText: string
  failSoft: string
  /** The agent's material — constant in both themes. */
  agentSurface: string
  agentSurfaceEdge: string
  agentText: string
  agentTextMuted: string
  agentPrompt: string
  controlBg: string
  controlBgHover: string
  controlBorder: string
  primaryBg: string
  primaryText: string
}

export const night: Palette = {
  ground: '#1B1613',
  raised: '#211C17',
  raised2: '#282219',
  recessed: '#100D0B',
  overlay: '#241E1A',
  text: '#F0EADD',
  textMuted: '#B3A794',
  textFaint: '#80756455',
  textFaintSolid: '#8A7F6D',
  textInverse: '#1B1613',
  borderSubtle: '#F0EADD14',
  borderStrong: '#F0EADD2B',
  scrim: '#0F0C0AB3',
  live: '#EF8B3F',
  liveText: '#F6A96A',
  liveSoft: '#EF8B3F1F',
  ok: '#93AC86',
  okText: '#AEC2A3',
  okSoft: '#93AC861F',
  fail: '#D95F4C',
  failText: '#E68A78',
  failSoft: '#D95F4C21',
  agentSurface: '#100D0B',
  agentSurfaceEdge: '#F0EADD0F',
  agentText: '#DDD5C4',
  agentTextMuted: '#968B77',
  agentPrompt: '#EF8B3F',
  controlBg: '#282219',
  controlBgHover: '#332B21',
  controlBorder: '#F0EADD1F',
  primaryBg: '#F9F5EE',
  primaryText: '#1B1613',
}

export const day: Palette = {
  ground: '#F3EDE2',
  raised: '#FDFBF7',
  raised2: '#F9F5EE',
  recessed: '#E9E1D2',
  overlay: '#FDFBF7',
  text: '#221C15',
  textMuted: '#6E6250',
  textFaint: '#4A404055',
  textFaintSolid: '#998C76',
  textInverse: '#F9F5EE',
  borderSubtle: '#221C1514',
  borderStrong: '#221C1526',
  scrim: '#2A231C59',
  live: '#E37A2C',
  liveText: '#C4631E',
  liveSoft: '#E37A2C24',
  ok: '#75906A',
  okText: '#5C7552',
  okSoft: '#75906A26',
  fail: '#BF4736',
  failText: '#A03A2C',
  failSoft: '#BF473621',
  agentSurface: '#100D0B',
  agentSurfaceEdge: '#F0EADD0F',
  agentText: '#DDD5C4',
  agentTextMuted: '#968B77',
  agentPrompt: '#EF8B3F',
  controlBg: '#FDFBF7',
  controlBgHover: '#F9F5EE',
  controlBorder: '#221C1526',
  primaryBg: '#1B1613',
  primaryText: '#F9F5EE',
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

/** Tight radii on controls, generous soft radii on big containers. */
export const radius = {
  tag: 4,
  control: 5,
  card: 14,
  panel: 18,
  full: 999,
} as const

export const fonts = {
  ui: 'InstrumentSans_400Regular',
  uiMedium: 'InstrumentSans_500Medium',
  uiSemiBold: 'InstrumentSans_600SemiBold',
  display: 'InstrumentSans_600SemiBold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoSemiBold: 'IBMPlexMono_600SemiBold',
} as const

export const type = {
  display: {
    fontFamily: fonts.display,
    fontSize: 21,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  title: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: fonts.ui,
    fontSize: 15,
    lineHeight: 23,
  },
  bodyStrong: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 15,
    lineHeight: 23,
  },
  caption: {
    fontFamily: fonts.uiMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  mono: {
    fontFamily: fonts.mono,
    fontSize: 13.5,
    lineHeight: 22,
    letterSpacing: 0.13,
  },
  monoSmall: {
    fontFamily: fonts.monoMedium,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0.12,
  },
  /** Uppercase mono section labels — pair with textTransform: 'uppercase'. */
  monoCaps: {
    fontFamily: fonts.monoMedium,
    fontSize: 10.5,
    lineHeight: 15,
    letterSpacing: 0.85,
  },
} satisfies Record<string, TextStyle>

export const motion = {
  fast: 120,
  base: 200,
  slow: 320,
  /** The single earned moment of delight: plays once on run acceptance. */
  tada: 900,
} as const

/**
 * Depth on the dark ground is drawn with edges + hairline borders rather
 * than big drop shadows; `card` is the resting raise, `lifted` the drag /
 * overlay state.
 */
export function shadows(palette: Palette): { card: ViewStyle; lifted: ViewStyle } {
  const isNight = palette === night
  // `boxShadow` rather than the shadow* props: react-native-web deprecates the latter (one
  // warning per screen), and RN 0.76+ renders boxShadow natively on both platforms.
  return {
    card: {
      boxShadow: `0 1px 2px rgba(0, 0, 0, ${isNight ? 0.18 : 0.08})`,
    },
    lifted: {
      boxShadow: `0 12px 24px rgba(0, 0, 0, ${isNight ? 0.65 : 0.2})`,
    },
  }
}
