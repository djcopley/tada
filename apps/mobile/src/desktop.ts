import type { Hold } from '@tada/shared'
import { holdPingText } from '@tada/shared'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'

export interface DesktopNotification {
  title: string
  body: string
  runId?: number
}

interface DesktopBridge {
  notify(n: DesktopNotification): void
  onOpenRun(cb: (runId: number) => void): () => void
}

/**
 * The bridge the Electron preload exposes (apps/desktop/src/preload.cts). Absent everywhere else —
 * iOS, Android and any browser — which is what makes every function here a no-op off the desktop
 * app. Nothing in this module may become required for the app to work.
 */
function bridge(): DesktopBridge | null {
  const found = (globalThis as { tadaDesktop?: DesktopBridge }).tadaDesktop
  return found ?? null
}

export function isDesktop(): boolean {
  return bridge() !== null
}

export function notifyDesktop(n: DesktopNotification): void {
  bridge()?.notify(n)
}

/**
 * The hold rides in on the same journal event the run screen reads:
 * `{ type: 'gate', payload: { kind: 'hold', hold } }`. `payload` is `unknown` over the wire, so
 * this is where it gets narrowed.
 */
export function holdFromRunEvent(event: { type: string; payload: unknown }): Hold | null {
  if (event.type !== 'gate') return null
  if (typeof event.payload !== 'object' || event.payload === null) return null
  const { kind, hold } = event.payload as Record<string, unknown>
  if (kind !== 'hold') return null
  if (typeof hold !== 'object' || hold === null) return null
  return hold as Hold
}

export function holdNotification(runId: number, hold: Hold): DesktopNotification {
  return { title: `Run #${runId} stopped on you`, body: holdPingText(hold), runId }
}

/**
 * Clicking a desktop notification lands on the run screen, which is where HoldActions renders.
 * A no-op off the desktop app; the subscription is dropped on unmount.
 */
export function useDesktopOpenRun(): void {
  const router = useRouter()
  useEffect(() => {
    const desktop = bridge()
    if (!desktop) return
    return desktop.onOpenRun((runId) => {
      router.push(`/runs/${runId}`)
    })
  }, [router])
}
