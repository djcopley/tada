type RouterLike = {
  back: () => void
  replace: (href: string) => void
  canGoBack?: () => boolean
}

/**
 * Header/ghost back: unwind the stack when there's history to go to, otherwise replace the
 * screen with `fallbackHref` — a screen opened cold (push notification tap, deep link, browser
 * refresh) has no back stack to return to, and a back control that does nothing is a dead end.
 */
export function goBackOr(router: RouterLike, fallbackHref: string): void {
  if (router.canGoBack?.()) {
    router.back()
  } else {
    router.replace(fallbackHref)
  }
}

/** The "← Control" ghost back the detail screens share (see {@link goBackOr}). */
export function goToControl(router: RouterLike): void {
  goBackOr(router, '/')
}

export type SectionKey = 'control' | 'board' | 'memory' | 'settings'

export const SECTION_HREF: Record<SectionKey, string> = {
  control: '/',
  board: '/board',
  memory: '/memory',
  settings: '/settings',
}

type SectionRouter = {
  navigate: (href: string) => void
}

/**
 * Switching between Control, Board, Memory and Settings from the Rail and BottomStrip. They are
 * tabs (see app/(tabs)/_layout.tsx), so this is a plain `navigate`: the tab navigator jumps
 * sideways to the target instead of pushing anything, and the active section is a no-op.
 */
export function goToSection(router: SectionRouter, opts: { key: SectionKey; active: SectionKey }): void {
  if (opts.key === opts.active) return
  router.navigate(SECTION_HREF[opts.key])
}
