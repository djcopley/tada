import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'
import { type EdgeInsets, SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * Repairs the safe-area insets for an installed iOS PWA, where the two halves iOS reports don't
 * describe the same rectangle.
 *
 * Measured in the running app on an iPhone 16 Pro (iOS 26), launched from the home screen:
 *
 *     screen 402x874   outerHeight 874   innerHeight 812   screenY 0   scale 1
 *     env(safe-area-inset-top) 62px      env(safe-area-inset-bottom) 34px
 *
 * The insets describe a view covering the whole 874pt screen — 62pt of status bar at the top, 34pt
 * of home indicator at the bottom. The view is actually 812pt tall and flush to the top, so the
 * bottom 62pt of the screen is not ours at all: the home indicator is already 28pt clear of our
 * last pixel. Padding by the reported 34 on top of that lifts the tab strip 34pt into the air for
 * nothing, which is exactly what it looked like.
 *
 * The top inset, by contrast, is honest — iOS really does composite the status bar over our first
 * 62pt — so it stays.
 *
 * So: subtract the uncovered strip from the bottom, and floor the top at it. The floor matters
 * because iOS does not always report the top inset at all (a page installed without a manifest
 * measured 0 here), and the height iOS withheld is exactly the strip it draws over us either way.
 * Both corrections collapse to nothing when the reported insets are already consistent, and the
 * whole thing is inert off web and outside a standalone launch.
 *
 * Injecting into SafeAreaInsetsContext rather than at each call site keeps `useSafeAreaInsets` the
 * single source every screen already reads.
 */
type Geometry = { standalone: boolean; screenHeight: number; innerHeight: number; screenY: number }

/**
 * How far iOS 26's scroll edge effect reaches past the safe-area inset. The effect blurs and dims
 * content near the top edge so it reads against the status bar; content inside it is not legibly
 * ours, which makes this unsafe area in every sense that matters to a layout.
 *
 * Measured, not derived — there is no way to query it, and no web-facing way to turn it off. (A
 * native app would use SwiftUI's `scrollEdgeEffectStyle(.hard, for: .top)`; nothing in Safari 26.x
 * exposes an equivalent.) So it is a constant, and a wrong one is a cosmetic gap rather than a
 * broken layout.
 */
const SCROLL_EDGE_FEATHER = 28

/** The arithmetic, separated from the DOM so it can be tested directly. */
export function repairInsets(insets: EdgeInsets, geometry: Geometry): EdgeInsets {
  const { standalone, screenHeight, innerHeight, screenY } = geometry
  // screenY > 0 would mean the strip iOS withheld is above us, not below, and the corrections
  // below would both be backwards. Bail rather than guess at a layout we have not seen.
  if (!standalone || screenY !== 0) return insets
  const uncovered = screenHeight - innerHeight
  // Only ever a status bar's worth. Anything larger is a rotation caught mid-measure or a chrome
  // we haven't seen, and acting on it would move the whole app for no reason.
  if (!(uncovered > 0 && uncovered <= 80)) return insets

  const top = Math.max(insets.top, uncovered) + SCROLL_EDGE_FEATHER
  const bottom = Math.max(0, insets.bottom - uncovered)
  // Same object identity when there is nothing to correct, so consumers re-render no more than
  // they did before this wrapper existed.
  if (top === insets.top && bottom === insets.bottom) return insets
  return { ...insets, top, bottom }
}

function readGeometry(): Geometry {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { standalone: false, screenHeight: 0, innerHeight: 0, screenY: 0 }
  }
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return {
    // `navigator.standalone` rather than a display-mode query: it is Safari-only, and every
    // correction here describes an iOS quirk. An Android home-screen app matches
    // `display-mode: standalone` too, has none of these problems, and would be pushed 28pt down
    // for a scroll edge effect it does not have.
    standalone: nav.standalone === true,
    screenHeight: window.screen.height,
    innerHeight: window.innerHeight,
    screenY: window.screenY,
  }
}

export function WebSafeAreaShim({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  // Lazily initialised, so the static export's Node prerender takes the inert branch and the real
  // measurement lands on hydration.
  const [geometry, setGeometry] = useState(readGeometry)

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return
    const update = () => setGeometry(readGeometry())
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  const value = useMemo(() => repairInsets(insets, geometry), [insets, geometry])
  return <SafeAreaInsetsContext.Provider value={value}>{children}</SafeAreaInsetsContext.Provider>
}
