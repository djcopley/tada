import { useEffect } from 'react'
import { Platform } from 'react-native'
import type { ThemeScheme } from '../settings'

/**
 * Keeps the *page canvas* painted with the ground of whatever screen is on top. Web-only; a no-op
 * on native.
 *
 * Installed to an iPhone home screen, the web view no longer covers the whole display. Measured on
 * an iPhone 16 Pro (iOS 26), a standalone launch reports:
 *
 *     screen 402x874   innerHeight 812   100dvh/100svh/100lvh/-webkit-fill-available all 812
 *     env(safe-area-inset-top) 0px       env(safe-area-inset-bottom) 0px
 *
 * The OS insets the view itself and tells the page it has no unsafe area, so `viewport-fit=cover`
 * buys us nothing here and there is no CSS length that reaches the missing strip — it is outside
 * the view entirely. iOS fills those strips by propagating the canvas background, which is the
 * html/body background. Leave that unset and they render white; the app's own ground stops at the
 * edge of the view and the seam shows as a band above the status bar and below the tab strip.
 *
 * So the strips can only be fixed from the document, and the document has to agree with whatever
 * the user is looking at. Two layers, because `app/connect.tsx` pins itself to paper day whatever
 * the stored scheme is: 'app' is the root scheme, 'screen' is a route overriding it. The screen
 * layer wins whenever it is mounted.
 *
 * The layers are keyed rather than stacked on purpose. Effects fire child-before-parent, so a
 * plain push/pop stack would let the root provider land on top of the screen that mounted inside
 * it and repaint the canvas out from under it.
 */
type Layer = { ground: string; scheme: ThemeScheme }

const layers = new Map<'app' | 'screen', Layer>()

function repaint(): void {
  const top = layers.get('screen') ?? layers.get('app')
  if (!top) return
  const root = document.documentElement
  root.style.backgroundColor = top.ground
  root.style.colorScheme = top.scheme === 'day' ? 'light' : 'dark'
  document.body.style.backgroundColor = top.ground
  // iOS reads this for the chrome it tints itself rather than samples from the canvas.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', top.ground)
}

export function useDocumentGround(key: 'app' | 'screen', ground: string, scheme: ThemeScheme): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    layers.set(key, { ground, scheme })
    repaint()
    return () => {
      layers.delete(key)
      repaint()
    }
  }, [key, ground, scheme])
}
