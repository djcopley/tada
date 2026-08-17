import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { timeStamp } from '../../runActivity'
import type { LineContextRequest } from '../EventFeed'
import { Button, Menu, Sheet } from '../ui'

export type LineAction = 'copy' | 'copyFrom' | 'note' | 'copyLog' | 'stop'

type Props = {
  request: LineContextRequest | null
  onClose: () => void
  onAction: (action: LineAction) => void
  /** Whether "Stop run" applies (the run is live). */
  canStop: boolean
}

const ITEMS: { key: LineAction; label: string; shortcut?: string; destructive?: boolean; divider?: boolean }[] = [
  { key: 'copy', label: 'Copy line', shortcut: '⌘C' },
  { key: 'copyFrom', label: 'Copy from here to end' },
  { key: 'note', label: 'Send a note about this step', shortcut: 'N', divider: true },
  { key: 'copyLog', label: 'Copy full log' },
  { key: 'stop', label: 'Stop run', destructive: true, divider: true },
]

/**
 * Context actions for one transcript line — a floating Menu at the pointer on web, a bottom
 * Sheet on mobile. Same action set, different vessel; user chrome, never mono (except the
 * caps header naming the line's stamp and the shortcut hints).
 */
export function LineMenu({ request, onClose, onAction, canStop }: Props) {
  const { colors } = useTheme()
  const visible = request !== null
  const stamp = request ? timeStamp(request.line.event.createdAt) : ''
  const items = ITEMS.filter((i) => i.key !== 'stop' || canStop)

  const rows = items.map((item, i) => (
    <View key={item.key}>
      {item.divider && i > 0 ? <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} /> : null}
      <Pressable
        testID={`line-menu-${item.key}`}
        accessibilityRole="button"
        onPress={() => onAction(item.key)}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.controlBgHover }]}
      >
        <Text style={[type.body, styles.rowLabel, { color: item.destructive ? colors.failText : colors.text }]}>
          {item.label}
        </Text>
        {item.shortcut && Platform.OS === 'web' ? (
          <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{item.shortcut}</Text>
        ) : null}
      </Pressable>
    </View>
  ))

  if (Platform.OS === 'web') {
    return (
      <Menu visible={visible} onClose={onClose} anchor={request?.anchor ?? null} testID="line-menu">
        <View style={styles.header}>
          <Text style={[type.monoCaps, styles.caps, { color: colors.textFaintSolid }]}>Line</Text>
          <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{stamp}</Text>
        </View>
        {rows}
      </Menu>
    )
  }

  return (
    <Sheet visible={visible} onClose={onClose} testID="line-menu">
      <View style={styles.header}>
        <Text style={[type.monoCaps, styles.caps, { color: colors.textFaintSolid }]}>Line</Text>
        <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{stamp}</Text>
      </View>
      <View style={[styles.sheetList, { backgroundColor: colors.raised, borderColor: colors.borderSubtle }]}>{rows}</View>
      <Button label="Cancel" variant="secondary" onPress={onClose} />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs + 1,
  },
  caps: { textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.sm,
    borderRadius: radius.control,
  },
  rowLabel: { flex: 1 },
  divider: { height: 1, marginVertical: 6, marginHorizontal: 4 },
  sheetList: {
    borderWidth: 1,
    borderRadius: radius.card,
    marginBottom: space.sm,
  },
})
