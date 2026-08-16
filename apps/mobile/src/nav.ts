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
  navigate: (href: string) => void
}

/**
 * Switching between Control and a workspace's Board/Memory/Settings from the Rail and
 * BottomStrip. They are tabs (see app/workspaces/_layout.tsx), so this is a plain `navigate`:
 * the tab navigator jumps sideways to the target instead of pushing anything, and the active
 * section is a no-op (tapping "Board" on Board does nothing).
 */
export function goToSection(
  router: SectionRouter,
  opts: { key: SectionKey; active: SectionKey; href: string },
): void {
  const { key, active, href } = opts
  if (key === active) return
  router.navigate(href)
}
