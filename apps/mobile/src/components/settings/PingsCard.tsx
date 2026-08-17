import type { ApiSettings, PingChannel } from '@tada/shared'
import { StyleSheet, Text, View } from 'react-native'
import { usePatchSettings } from '../../api/queries'
import { useTheme } from '../../design/ThemeContext'
import { type } from '../../design/tokens'
import { REPING_OPTIONS_MIN, repingLabel } from '../../settingsScreen'
import { Button, Icon, ListRow, Menu } from '../ui'
import { useAnchoredMenu } from './AnchoredMenu'
import { type Segment, SegmentedPill } from './SegmentedPill'
import { SettingsRow, SettingsSection } from './SettingsSection'

const CHANNELS: Segment<PingChannel>[] = [
  { value: 'push', label: 'Push' },
  { value: 'off', label: 'Off' },
]

/** Pings: one channel, one re-ping — the whole notifications story. Finished runs are quiet. */
export function PingsCard({ settings }: { settings: ApiSettings }) {
  const { colors } = useTheme()
  const patch = usePatchSettings()
  const { triggerRef: repingMenuTrigger, visible: repingMenuVisible, anchor: repingMenuAnchor, open: openRepingMenu, close: closeRepingMenu } = useAnchoredMenu()
  const currentMinutes = Math.round(settings.repingMs / 60_000)

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
