import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'
import { loadThemeScheme, saveThemeScheme, type ThemeScheme } from '../settings'
import { day, night, type Palette, shadows } from './tokens'

export type Theme = {
  /** 'night' (dark, the default) or 'day' (opt-in paper light). */
  scheme: ThemeScheme
  colors: Palette
  shadow: ReturnType<typeof shadows>
  /** Flip between night watch and paper day; persisted across launches. */
  setScheme: (scheme: ThemeScheme) => void
}

const noop = () => {}

export function buildTheme(scheme: ThemeScheme, setScheme: (s: ThemeScheme) => void = noop): Theme {
  const colors = scheme === 'day' ? day : night
  return { scheme, colors, shadow: shadows(colors), setScheme }
}

export const ThemeContext = createContext<Theme | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setSchemeState] = useState<ThemeScheme>('night')

  useEffect(() => {
    let cancelled = false
    void loadThemeScheme().then((stored) => {
      if (!cancelled) setSchemeState(stored)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Web-only. An installed PWA paints its safe-area strips (the notch band, the bar below the
  // home indicator) from the document background, not from the React tree — see the matching
  // comment in app/+html.tsx. The static rule there is night's ground; this follows the scheme
  // when it changes, so paper day doesn't get dark strips top and bottom.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    const { ground } = scheme === 'day' ? day : night
    document.documentElement.style.backgroundColor = ground
    document.documentElement.style.colorScheme = scheme === 'day' ? 'light' : 'dark'
    document.body.style.backgroundColor = ground
    // iOS reads this for the strips it tints itself rather than samples.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ground)
  }, [scheme])

  const setScheme = useCallback((next: ThemeScheme) => {
    setSchemeState(next)
    void saveThemeScheme(next)
  }, [])

  const value = useMemo(() => buildTheme(scheme, setScheme), [scheme, setScheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/**
 * Resolves the active theme. Falls back to night watch when no ThemeProvider
 * is mounted (tests render screens without the root layout).
 */
export function useTheme(): Theme {
  const fromContext = useContext(ThemeContext)
  const fallback = useMemo(() => buildTheme('night', noop), [])
  return fromContext ?? fallback
}
