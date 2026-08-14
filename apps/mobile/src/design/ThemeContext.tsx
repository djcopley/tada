import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
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

function buildTheme(scheme: ThemeScheme, setScheme: (s: ThemeScheme) => void): Theme {
  const colors = scheme === 'day' ? day : night
  return { scheme, colors, shadow: shadows(colors), setScheme }
}

const ThemeContext = createContext<Theme | null>(null)

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
