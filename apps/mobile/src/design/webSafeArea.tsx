import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * Repairs the top safe-area inset for an installed iOS PWA, where iOS reports none.
 *
 * Measured on an iPhone 16 Pro (iOS 26), launched from the home screen with a manifest:
 *
 *     screen 402x874   outerHeight 874   innerHeight 812   screenY 0
 *     visualViewport.offsetTop 0         env(safe-area-inset-top/bottom) 0px
 *
 * iOS reserves the status bar's height out of the view's *height* but leaves its *origin* at the
 * top of the screen, then reports no unsafe area. So the status bar is composited over the first
 * 62pt of the app — every screen's header sat under it — while an equal 62pt strip at the bottom
 * of the screen is left uncovered. Painting that strip is documentGround.ts's job; this is the
 * other half.
 *
 * The height iOS withheld is exactly the strip it is drawing over us, so `screen.height -
 * innerHeight` recovers it — derived from the geometry rather than a hardcoded status bar height,
 * which differs across devices. It is applied as a floor on the reported inset, so the moment iOS
 * reports a real one (or on any other platform) this contributes nothing.
 *
 * Injecting it into SafeAreaInsetsContext rather than at each call site means `useSafeAreaInsets`
 * keeps being the single source every screen already reads.
 */
/** The arithmetic, separated from the DOM so it can be tested directly. */
export function withheldTopFrom(m: { standalone: boolean; screenHeight: number; innerHeight: number }): number {
  if (!m.standalone) return 0
  const withheld = m.screenHeight - m.innerHeight
  // Only ever a status bar's worth. Anything larger is a rotation caught mid-measure or a chrome
  // we haven't seen, and guessing wide there would push the whole app down for no reason.
  return withheld > 0 && withheld <= 80 ? withheld : 0
}

function measureWithheldTop(): number {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return 0
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return withheldTopFrom({
    standalone: nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
    screenHeight: window.screen.height,
    innerHeight: window.innerHeight,
  })
}

export function WebSafeAreaShim({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  // Lazily initialised, so the static export's Node prerender takes the 0 branch and the real
  // measurement lands on hydration.
  const [withheld, setWithheld] = useState(measureWithheldTop)

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return
    const update = () => setWithheld(measureWithheldTop())
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  // Same object identity when there is nothing to add, so native and desktop web re-render no
  // more than they did before this wrapper existed.
  const value = useMemo(
    () => (insets.top >= withheld ? insets : { ...insets, top: withheld }),
    [insets, withheld],
  )
  return <SafeAreaInsetsContext.Provider value={value}>{children}</SafeAreaInsetsContext.Provider>
}
