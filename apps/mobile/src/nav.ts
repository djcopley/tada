type RouterLike = {
  back: () => void
  push: (href: string) => void
  canGoBack?: () => boolean
}

/**
 * The "← Control" ghost back both detail screens share: unwind the stack when there's history
 * to go to (opened from Control's needs-you/live lists), otherwise land on the workspace list —
 * a screen opened cold (push notification tap, deep link) has no back stack to return to.
 */
export function goToControl(router: RouterLike): void {
  if (router.canGoBack?.()) {
    router.back()
  } else {
    router.push('/workspaces')
  }
}
