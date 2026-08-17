import type { ApiSettings } from '@tada/shared'
import { StyleSheet, Text, View } from 'react-native'
import { usePatchSettings } from '../../api/queries'
import { useTheme } from '../../design/ThemeContext'
import { type } from '../../design/tokens'
import { CONCURRENCY_MAX, CONCURRENCY_MIN, durationLabel, TIMEOUT_OPTIONS_MIN } from '../../settingsScreen'
import { Button, Icon, ListRow, Menu, Stepper } from '../ui'
import { useAnchoredMenu } from './AnchoredMenu'
import { SettingsRow, SettingsSection } from './SettingsSection'

/** Run limits: how many agents work at once (held runs don't count) and the per-run time budget
 * (past it the run stops and asks for more time — a hold, not a failure). */
export function LimitsCard({ settings }: { settings: ApiSettings }) {
  const { colors } = useTheme()
  const patch = usePatchSettings()
  const { triggerRef: timeoutMenuTrigger, visible: timeoutMenuVisible, anchor: timeoutMenuAnchor, open: openTimeoutMenu, close: closeTimeoutMenu } = useAnchoredMenu()
  const currentMinutes = Math.round(settings.timeoutMs / 60_000)

  return (
    <SettingsSection title="Run limits" testID="settings-limits">
      <SettingsRow>
        <View style={styles.text}>
          <Text style={[type.bodyStrong, { color: colors.text }]}>Concurrent runs</Text>
          <Text style={[type.caption, { color: colors.textFaintSolid }]}>{"Agents working at once — held runs don't count"}</Text>
        </View>
        <View style={styles.flex1} />
        <Stepper
          testID="concurrency-stepper"
          value={settings.concurrency}
          min={CONCURRENCY_MIN}
          max={CONCURRENCY_MAX}
          onDecrement={() => {
            if (settings.concurrency > CONCURRENCY_MIN) patch.mutate({ concurrency: settings.concurrency - 1 })
          }}
          onIncrement={() => {
            if (settings.concurrency < CONCURRENCY_MAX) patch.mutate({ concurrency: settings.concurrency + 1 })
          }}
        />
      </SettingsRow>
      <SettingsRow last>
        <View style={styles.text}>
          <Text style={[type.bodyStrong, { color: colors.text }]}>Per-run time budget</Text>
          <Text style={[type.caption, { color: colors.textFaintSolid }]}>Past this the run stops and asks you for more time</Text>
        </View>
        <View style={styles.flex1} />
        <View ref={timeoutMenuTrigger} collapsable={false}>
          <Button testID="timeout-menu-trigger" variant="secondary" small label={`${durationLabel(currentMinutes)} ▾`} onPress={openTimeoutMenu} />
        </View>
      </SettingsRow>

      <Menu visible={timeoutMenuVisible} anchor={timeoutMenuAnchor} onClose={closeTimeoutMenu} testID="timeout-menu">
        {TIMEOUT_OPTIONS_MIN.map((minutes) => (
          <ListRow
            key={minutes}
            testID={`timeout-option-${minutes}`}
            title={durationLabel(minutes)}
            trailing={minutes === currentMinutes ? <Icon name="check" size={16} color={colors.text} /> : null}
            onPress={() => {
              closeTimeoutMenu()
              if (minutes !== currentMinutes) patch.mutate({ timeoutMs: minutes * 60_000 })
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
