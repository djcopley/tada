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

/** The "← Control" ghost back both detail screens share (see {@link goBackOr}). */
export function goToControl(router: RouterLike): void {
  goBackOr(router, '/workspaces')
}

export type SectionKey = 'control' | 'board' | 'memory' | 'settings'

type SectionRouter = {
  push: (href: string) => void
  replace: (href: string) => void
  dismissTo: (href: string) => void
}

/**
 * Tab-like switching between Control and a workspace's Board/Memory/Settings from the Rail and
 * BottomStrip. Keeps the stack at most `[Control, one section]` instead of pushing a fresh copy
 * per tap:
 *   - the active section is a no-op (tapping "Board" on Board does nothing);
 *   - Control pops back to the Control already in the stack (dismissTo replaces when it isn't);
 *   - a section opened from Control is pushed, so back returns to Control;
 *   - switching between sections replaces the current one, so back still returns to Control.
 */
export function goToSection(
  router: SectionRouter,
  opts: { key: SectionKey; active: SectionKey; href: string },
): void {
  const { key, active, href } = opts
  if (key === active) return
  if (key === 'control') {
    router.dismissTo(href)
    return
  }
  if (active === 'control') {
    router.push(href)
  } else {
    router.replace(href)
  }
}
