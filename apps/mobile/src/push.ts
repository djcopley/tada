import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import type { TadaClient } from './api/client'

/**
 * Registers this device for push notifications and posts the resulting
 * Expo push token to the server. Deliberately swallows every failure —
 * permission APIs, token retrieval, or the network call itself — so a
 * broken push setup (missing projectId in dev, a flaky network, a user who
 * denies the prompt) never breaks app startup. Skips entirely on web,
 * which has no permission model to call into.
 */
export async function registerForPush(client: TadaClient): Promise<void> {
  if (Platform.OS === 'web') return

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
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    )
    await client.registerPushToken(tokenResponse.data)
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
