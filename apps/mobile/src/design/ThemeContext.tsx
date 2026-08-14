import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { useColorScheme } from 'react-native'
import { dark, light, type Palette, shadows } from './tokens'

export type Theme = {
  scheme: 'light' | 'dark'
  colors: Palette
  shadow: ReturnType<typeof shadows>
}

function buildTheme(scheme: 'light' | 'dark'): Theme {
  const colors = scheme === 'dark' ? dark : light
  return { scheme, colors, shadow: shadows(colors) }
}

const ThemeContext = createContext<Theme | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const value = useMemo(() => buildTheme(scheme), [scheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/**
 * Resolves the active theme. Falls back to computing straight from the OS
 * color scheme when no ThemeProvider is mounted (tests render screens
 * without the root layout).
 */
export function useTheme(): Theme {
  const fromContext = useContext(ThemeContext)
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const fallback = useMemo(() => buildTheme(scheme), [scheme])
  return fromContext ?? fallback
}
