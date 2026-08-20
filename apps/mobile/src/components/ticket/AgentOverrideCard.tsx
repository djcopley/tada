import type { ApiAdapterInfo, ApiSettings, ApiTicketDetail } from '@tada/shared'
import { StyleSheet, Text, View } from 'react-native'
import { useAdapters, usePatchTicket } from '../../api/queries'
import { useAnchoredMenu } from '../settings/AnchoredMenu'
import { useTheme } from '../../design/ThemeContext'
import { humanize } from '../../design/status'
import { space, type } from '../../design/tokens'
import { Button, Card, Icon, ListRow, Menu } from '../ui'
import { CardHeader } from './TicketCards'

/**
 * Optional per-ticket override of the global harness/model, validated by the server exactly like
 * the global settings are (`AgentCard`). `null` on both fields means "use the global settings" —
 * that's the "Global" option below, not just an unset default.
 */
export function AgentOverrideCard({ ticketId, ticket, settings }: { ticketId: number; ticket: ApiTicketDetail; settings: ApiSettings }) {
  const { colors } = useTheme()
  const { data: adapters } = useAdapters()
  const patch = usePatchTicket()
  const { triggerRef: modelMenuTrigger, visible: modelMenuVisible, anchor: modelMenuAnchor, open: openModelMenu, close: closeModelMenu } = useAnchoredMenu()

  const effectiveAdapterId = ticket.adapter ?? settings.adapter
  const effectiveModel = ticket.model ?? settings.model
  const current: ApiAdapterInfo | undefined = adapters?.find((a) => a.id === effectiveAdapterId)
  const overridden = ticket.adapter !== null || ticket.model !== null

  const useGlobal = () => {
    if (!overridden) return
    patch.mutate({ id: ticketId, patch: { adapter: null, model: null } })
  }

  const chooseHarness = (adapter: ApiAdapterInfo) => {
    if (!adapter.available || adapter.id === ticket.adapter) return
    // Keep the current effective model when the new harness offers it, otherwise its first model
    // — the same fallback `AgentCard` applies when switching the global harness.
    const model = adapter.models.includes(effectiveModel) ? effectiveModel : (adapter.models[0] ?? null)
    patch.mutate({ id: ticketId, patch: { adapter: adapter.id, model } })
  }

  const chooseModel = (model: string) => {
    closeModelMenu()
    if (model === ticket.model) return
    patch.mutate({ id: ticketId, patch: { model } })
  }

  return (
    <Card testID="ticket-agent-override" style={styles.card}>
      <CardHeader title="Agent override" meta={overridden ? 'overriding global' : 'using global'} />
      <View style={styles.body}>
        <View style={styles.row}>
          <Text style={[type.caption, styles.label, { color: colors.text }]}>Harness</Text>
          <Button testID="ticket-harness-global" variant={ticket.adapter === null ? 'secondary' : 'ghost'} small label="Global" onPress={useGlobal} />
          {(adapters ?? []).map((adapter) => (
            <Button
              key={adapter.id}
              testID={`ticket-harness-${adapter.id}`}
              variant={adapter.id === ticket.adapter ? 'secondary' : 'ghost'}
              small
              label={adapter.label}
              disabled={!adapter.available}
              onPress={() => chooseHarness(adapter)}
            />
          ))}
        </View>

        <View style={styles.row}>
          <Text style={[type.caption, styles.label, { color: colors.text }]}>Model</Text>
          <View ref={modelMenuTrigger} collapsable={false}>
            <Button testID="ticket-model-menu-trigger" variant="secondary" small label={`${humanize(effectiveModel)} ▾`} onPress={openModelMenu} />
          </View>
        </View>

        <Text style={[type.caption, { color: colors.textFaintSolid }]}>
          {overridden ? 'This ticket uses its own harness/model instead of the global settings.' : 'Currently using the global agent settings.'}
        </Text>
      </View>

      <Menu visible={modelMenuVisible} anchor={modelMenuAnchor} onClose={closeModelMenu} testID="ticket-model-menu">
        {(current?.models ?? []).map((model) => (
          <ListRow
            key={model}
            testID={`ticket-model-option-${model}`}
            title={humanize(model)}
            trailing={model === effectiveModel ? <Icon name="check" size={16} color={colors.text} /> : null}
            onPress={() => chooseModel(model)}
          />
        ))}
      </Menu>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  body: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  label: { fontWeight: '500', width: 70 },
})
