import type { ApiAdapterInfo, ApiSettings } from '@tada/shared'
import { StyleSheet, Text, View } from 'react-native'
import { useAdapters, usePatchSettings } from '../../api/queries'
import { useTheme } from '../../design/ThemeContext'
import { humanize } from '../../design/status'
import { space, type } from '../../design/tokens'
import { Button, Icon, ListRow, Menu } from '../ui'
import { useAnchoredMenu } from './AnchoredMenu'
import { SettingsSection } from './SettingsSection'

/** Agent: harness, model, effort — one setting each, validated by the server against the
 * harness. Model and effort options come from the selected harness. */
export function AgentCard({ settings }: { settings: ApiSettings }) {
  const { colors } = useTheme()
  const { data: adapters } = useAdapters()
  const patch = usePatchSettings()
  const { triggerRef: modelMenuTrigger, visible: modelMenuVisible, anchor: modelMenuAnchor, open: openModelMenu, close: closeModelMenu } = useAnchoredMenu()

  const current: ApiAdapterInfo | undefined = adapters?.find((a) => a.id === settings.adapter)

  const chooseHarness = (adapter: ApiAdapterInfo) => {
    if (!adapter.available || adapter.id === settings.adapter) return
    // Keep the current model/effort when the new harness offers them; otherwise its first model
    // and 'medium' (else its first effort) — the same fallback the server applies.
    const model = adapter.models.includes(settings.model) ? settings.model : (adapter.models[0] ?? '')
    const effort = adapter.efforts.includes(settings.effort)
      ? settings.effort
      : adapter.efforts.includes('medium')
        ? 'medium'
        : (adapter.efforts[0] ?? '')
    patch.mutate({ adapter: adapter.id, model, effort })
  }

  return (
    <SettingsSection title="Agent" testID="settings-agent">
      <View style={styles.body}>
        <View style={styles.row}>
          <Text style={[type.caption, styles.label, { color: colors.text }]}>Harness</Text>
          {(adapters ?? []).map((adapter) => (
            <View key={adapter.id} style={styles.segmentedItem}>
              <Button
                testID={`harness-${adapter.id}`}
                variant={adapter.id === settings.adapter ? 'secondary' : 'ghost'}
                small
                label={adapter.label}
                disabled={!adapter.available}
                onPress={() => chooseHarness(adapter)}
              />
              {!adapter.available ? (
                <Text testID={`harness-hint-${adapter.id}`} style={[type.caption, styles.hint, { color: colors.textFaintSolid }]}>
                  not installed on the server
                </Text>
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.row}>
          <Text style={[type.caption, styles.label, { color: colors.text }]}>Model</Text>
          <View ref={modelMenuTrigger} collapsable={false}>
            <Button testID="model-menu-trigger" variant="secondary" small label={`${humanize(settings.model)} ▾`} onPress={openModelMenu} />
          </View>
          <Text style={[type.caption, styles.label, styles.effortLabel, { color: colors.text }]}>Effort</Text>
          {(current?.efforts ?? []).map((effort) => (
            <Button
              key={effort}
              testID={`effort-${effort}`}
              variant={effort === settings.effort ? 'secondary' : 'ghost'}
              small
              label={humanize(effort)}
              onPress={() => {
                if (effort !== settings.effort) patch.mutate({ effort })
              }}
            />
          ))}
        </View>

        <Text style={[type.caption, { color: colors.textFaintSolid }]}>Model and effort options come from the selected harness.</Text>
      </View>

      <Menu visible={modelMenuVisible} anchor={modelMenuAnchor} onClose={closeModelMenu} testID="model-menu">
        {(current?.models ?? []).map((model) => (
          <ListRow
            key={model}
            testID={`model-option-${model}`}
            title={humanize(model)}
            trailing={model === settings.model ? <Icon name="check" size={16} color={colors.text} /> : null}
            onPress={() => {
              closeModelMenu()
              if (model !== settings.model) patch.mutate({ model })
            }}
          />
        ))}
      </Menu>
    </SettingsSection>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  label: { fontWeight: '500', width: 70 },
  effortLabel: { width: undefined, marginLeft: space.sm },
  segmentedItem: { alignItems: 'center', gap: 2 },
  hint: { maxWidth: 96, textAlign: 'center' },
})
