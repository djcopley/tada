import { useRunEventListener } from '../api/AppSocketContext'
import { holdFromRunEvent, holdNotification, notifyDesktop, useDesktopOpenRun } from '../desktop'

/**
 * The desktop app's ping channel. Web push does not work in Electron (its Chromium has no push
 * service), so the socket the app already holds is what raises the OS notification — which means
 * desktop pings only fire while the app is running. Renders nothing, and is inert everywhere but
 * the Electron shell.
 */
export function DesktopBridge() {
  useDesktopOpenRun()
  useRunEventListener((msg) => {
    const hold = holdFromRunEvent(msg.event)
    if (hold) notifyDesktop(holdNotification(msg.runId, hold))
  })
  return null
}
