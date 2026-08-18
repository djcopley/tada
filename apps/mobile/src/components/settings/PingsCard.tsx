import type { ApiSettings, PingChannel } from '@tada/shared'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { usePatchSettings } from '../../api/queries'
import { useConnection } from '../../ConnectionContext'
import { useTheme } from '../../design/ThemeContext'
import { type } from '../../design/tokens'
import { REPING_OPTIONS_MIN, repingLabel } from '../../settingsScreen'
import { showToast } from '../../toast'
import { enableWebPush, type PushUiState, pushUiState, readPushEnv } from '../../webPush'
import { Button, Icon, ListRow, Menu } from '../ui'
import { useAnchoredMenu } from './AnchoredMenu'
import { type Segment, SegmentedPill } from './SegmentedPill'
import { SettingsRow, SettingsSection } from './SettingsSection'

const CHANNELS: Segment<PingChannel>[] = [
  { value: 'push', label: 'Push' },
  { value: 'off', label: 'Off' },
]

/** Caption per push state. 'unsupported' never renders, but the map is total so the lookup needs
 * no fallback. 'blocked' has no in-app remedy: Safari only re-asks for a freshly installed PWA. */
const PUSH_CAPTION: Record<PushUiState, string> = {
  unsupported: '',
  'needs-install': 'Add to Home Screen first — Safari only allows notifications in an installed app',
  blocked: 'Blocked. Delete the home screen icon and add it again to retry',
  enabled: 'On for this browser',
  'can-enable': 'Get pinged even when this app is closed',
}

/** Pings: one channel, one re-ping — the whole notifications story. Finished runs are quiet. */
export function PingsCard({ settings }: { settings: ApiSettings }) {
  const { colors } = useTheme()
  const patch = usePatchSettings()
  const { triggerRef: repingMenuTrigger, visible: repingMenuVisible, anchor: repingMenuAnchor, open: openRepingMenu, close: closeRepingMenu } = useAnchoredMenu()
  const currentMinutes = Math.round(settings.repingMs / 60_000)
  const { client } = useConnection()
  // Read once and re-read after the opt-in resolves: Notification.permission is a live browser
  // value with no change event worth subscribing to, and it can only move while we're the ones
  // asking. Lazy initializer so nothing touches `window` during the native render pass.
  const [env, setEnv] = useState(readPushEnv)
  const [busy, setBusy] = useState(false)
  const state = pushUiState(env)

  // enableWebPush throws for everything except an outright refusal (network failure, a service
  // worker that won't register, InvalidStateError from a stale subscription). Unhandled, that is a
  // silent rejection and the button just appears dead — so every failure gets a toast.
  const onEnable = async () => {
    if (!client) return
    setBusy(true)
    try {
      const on = await enableWebPush(client)
      if (!on) showToast('Notifications are off — the browser refused permission')
    } catch {
      showToast('Could not turn on notifications in this browser')
    } finally {
      // Re-read regardless: permission may have been granted even if the subscribe leg failed,
      // and the row must reflect what the browser actually thinks.
      setEnv(readPushEnv())
      setBusy(false)
    }
  }

  const onTest = async () => {
    if (!client) return
    setBusy(true)
    try {
      await client.sendTestPing()
      showToast('Test ping sent')
    } catch {
      showToast('Could not send a test ping')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection title="Pings" testID="settings-pings">
      <SettingsRow>
        <View style={styles.text}>
          <Text style={[type.bodyStrong, { color: colors.text }]}>When a run stops on you</Text>
          <Text style={[type.caption, { color: colors.textFaintSolid }]}>Permission, question, out of time, failure — one ping each</Text>
        </View>
        <View style={styles.flex1} />
        <SegmentedPill<PingChannel>
          testID="ping-channel"
          value={settings.pingChannel}
          segments={CHANNELS}
          onChange={(pingChannel) => patch.mutate({ pingChannel })}
        />
      </SettingsRow>
      {/* Hidden outright where the browser has no push at all (every native build, and any
          desktop browser without a PushManager) — an unusable control is worse than no control. */}
      {state !== 'unsupported' && (
        <SettingsRow>
          <View style={styles.text}>
            <Text style={[type.bodyStrong, { color: colors.text }]}>Notifications in this browser</Text>
            <Text style={[type.caption, { color: colors.textFaintSolid }]}>{PUSH_CAPTION[state]}</Text>
          </View>
          <View style={styles.flex1} />
          {state === 'can-enable' && <Button testID="web-push-action" variant="secondary" small label="Enable" disabled={busy} onPress={onEnable} />}
          {state === 'enabled' && <Button testID="web-push-action" variant="secondary" small label="Send test" disabled={busy} onPress={onTest} />}
        </SettingsRow>
      )}
      <SettingsRow last>
        <View style={styles.text}>
          <Text style={[type.bodyStrong, { color: colors.text }]}>Re-ping while held</Text>
          <Text style={[type.caption, { color: colors.textFaintSolid }]}>A second nudge if a stopped run is still waiting</Text>
        </View>
        <View style={styles.flex1} />
        <View ref={repingMenuTrigger} collapsable={false}>
          <Button testID="reping-menu-trigger" variant="secondary" small label={`${repingLabel(currentMinutes)} ▾`} onPress={openRepingMenu} />
        </View>
      </SettingsRow>

      <Menu visible={repingMenuVisible} anchor={repingMenuAnchor} onClose={closeRepingMenu} testID="reping-menu">
        {REPING_OPTIONS_MIN.map((minutes) => (
          <ListRow
            key={minutes}
            testID={`reping-option-${minutes}`}
            title={repingLabel(minutes)}
            trailing={minutes === currentMinutes ? <Icon name="check" size={16} color={colors.text} /> : null}
            onPress={() => {
              closeRepingMenu()
              if (minutes !== currentMinutes) patch.mutate({ repingMs: minutes * 60_000 })
            }}
          />
        ))}
      </Menu>
    </SettingsSection>
  )
}

const styles = StyleSheet.create({
  text: { flexShrink: 1, gap: 2 },
  flex1: { flex: 1 },
})
