import type { ApiTicket, ApiWorkspace, ColumnKind } from '@tada/shared'
import { Pressable, StyleSheet, Text, View } from 'react-native'

/**
 * Status glyph precedence: an explicit queueState (queued/held) always wins
 * over the column-derived hint, since it reflects the ticket's own state
 * rather than a guess based on where it currently sits.
 */
function StatusGlyph({ ticket, columnKind }: { ticket: ApiTicket; columnKind: ColumnKind }) {
  if (ticket.queueState === 'queued') {
    return (
      <Text testID={`ticket-glyph-${ticket.id}`} style={styles.glyph}>
        ⏳
      </Text>
    )
  }
  if (ticket.queueState === 'held') {
    return (
      <Text testID={`ticket-glyph-${ticket.id}`} style={[styles.badge, styles.failedBadge]}>
        ⚠ failed
      </Text>
    )
  }
  if (columnKind === 'in_progress') {
    return (
      <Text testID={`ticket-glyph-${ticket.id}`} style={styles.glyph}>
        ▶ running
      </Text>
    )
  }
  if (columnKind === 'in_review') {
    return (
      <Text testID={`ticket-glyph-${ticket.id}`} style={styles.dot}>
        ●
      </Text>
    )
  }
  return null
}

export function TicketCard({
  ticket,
  workspace,
  columnKind,
  onPress,
  onLongPress,
}: {
  ticket: ApiTicket
  workspace: ApiWorkspace
  columnKind: ColumnKind
  onPress: () => void
  onLongPress?: () => void
}) {
  const adapter = ticket.adapterOverride ?? workspace.defaultAdapter
  const model = ticket.modelOverride ?? workspace.defaultModel

  return (
    <Pressable
      testID={`ticket-card-${ticket.id}`}
      style={styles.card}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <Text style={styles.title}>{ticket.title}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.chip}>{`${adapter} · ${model}`}</Text>
        <StatusGlyph ticket={ticket} columnKind={columnKind} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 8,
    padding: 12,
    marginVertical: 4,
    gap: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chip: {
    fontSize: 12,
    color: '#555',
  },
  glyph: {
    fontSize: 12,
    color: '#555',
  },
  dot: {
    fontSize: 12,
    color: '#b35c00',
  },
  badge: {
    fontSize: 11,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  failedBadge: {
    backgroundColor: '#fdeaea',
    color: '#c62828',
  },
})
