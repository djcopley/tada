import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import type { TadaClient } from './api/client'

type NotificationsModule = typeof import('expo-notifications')

let handlerInstalled = false

/**
 * expo-notifications is loaded lazily and only off-web: merely importing it on web logs
 * "Listening to push token changes is not yet fully supported on web" on every page load, and
 * nothing here runs on web anyway. First load also installs the foreground handler so a
 * notification that arrives while the app is open is actually shown.
 */
function loadNotifications(): NotificationsModule | null {
  if (Platform.OS === 'web') return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberately not a static import (see above)
  const Notifications = require('expo-notifications') as NotificationsModule
  if (!handlerInstalled) {
    handlerInstalled = true
    Notifications.setNotificationHandler?.({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    })
  }
  return Notifications
}

/**
 * Registers this device for push notifications and posts the resulting
 * Expo push token to the server. Deliberately swallows every failure —
 * permission APIs, token retrieval, or the network call itself — so a
 * broken push setup (missing projectId in dev, a flaky network, a user who
 * denies the prompt) never breaks app startup. Skips entirely on web,
 * which has no permission model to call into.
 */
export async function registerForPush(client: TadaClient): Promise<void> {
  const Notifications = loadNotifications()
  if (!Notifications) return

  try {
    const current = await Notifications.getPermissionsAsync()
    let status = current.status
    if (status === 'undetermined') {
      const requested = await Notifications.requestPermissionsAsync()
      status = requested.status
    }
    if (status !== 'granted') return

    // Required by getExpoPushTokenAsync outside of Expo Go on modern SDKs;
    // absent in most local dev setups, so pass it only when present.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined
    let token: string
    try {
      token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data
    } catch (err) {
      // Without an EAS projectId (every local dev build) token retrieval is expected to fail, so
      // that case is a debug line rather than a warning on every connect.
      if (projectId) console.warn('Push registration failed', err)
      else console.debug('Push registration skipped (no EAS projectId configured)', err)
      return
    }
    await client.registerPushToken(token)
  } catch (err) {
    console.warn('Push registration failed', err)
  }
}

function ticketIdFromNotificationData(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null
  const raw = (data as Record<string, unknown>).ticketId
  const ticketId = Number(raw)
  return Number.isFinite(ticketId) ? ticketId : null
}

/**
 * Wires notification taps to in-app navigation. Handles both the
 * already-running case (addNotificationResponseReceivedListener) and the
 * cold-start case, where the app is launched by tapping a notification and
 * there's no listener yet to catch it (getLastNotificationResponseAsync).
 *
 * Note: if the device is disconnected (no stored connection), the
 * tickets/_layout route guard redirects to /connect regardless of this
 * push, so a tap while disconnected lands on the connect screen rather
 * than the ticket — acceptable per the task 4 ledger note.
 */
export function useNotificationDeepLinks(): void {
  const router = useRouter()

  useEffect(() => {
    if (Platform.OS === 'web') return

    const Notifications = loadNotifications()
    if (!Notifications) return

    let cancelled = false

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled || !response) return
      const ticketId = ticketIdFromNotificationData(response.notification.request.content.data)
      if (ticketId !== null) router.push(`/tickets/${ticketId}`)
    })

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const ticketId = ticketIdFromNotificationData(response.notification.request.content.data)
      if (ticketId !== null) router.push(`/tickets/${ticketId}`)
    })

    return () => {
      cancelled = true
      subscription.remove()
    }
  }, [router])
}
