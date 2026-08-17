import type { ApiRun, ApiTicketDetail } from '@tada/shared'
import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { stoppedSince } from '../../control'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { attemptRows, runCardLines, runCardMeta, stoppedCopy, stoppedWellLines } from '../../ticketDetail'
import { HoldActions } from '../gate/HoldActions'
import { Card } from '../ui'

/** Card title row: sans title left, mono meta right. */
export function CardHeader({ title, meta }: { title: string; meta?: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.cardHeader}>
      <Text style={[type.bodyStrong, { color: colors.text }]}>{title}</Text>
      <View style={styles.spacer} />
      {meta ? <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{meta}</Text> : null}
    </View>
  )
}

/** The recessed agent well: mono lines on agent ink. */
export function AgentWell({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors } = useTheme()
  return (
    <View testID={testID} style={[styles.well, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}>
      {children}
    </View>
  )
}

/**
 * The stopped-on-you card: why it stopped, the agent's last word, the actions for that reason,
 * and the one paragraph explaining what each does. Renders nothing for a run that isn't stopped.
 */
export function StoppedCard({ run, ticketId, now }: { run: ApiRun; ticketId: number; now: number }) {
  const { colors } = useTheme()
  const copy = stoppedCopy(run)
  if (!copy) return null
  const lines = stoppedWellLines(run, ticketId)
  return (
    <Card testID="stopped-card" style={styles.card}>
      <CardHeader title={copy.title} meta={stoppedSince(run, now)} />
      <AgentWell testID="stopped-well">
        {lines.map((line, i) => (
          <View key={`${line.prefix}-${i}`} style={[styles.wellLine, i > 0 && { borderTopColor: colors.agentSurfaceEdge, borderTopWidth: 1, paddingTop: space.xs + 2 }]}>
            <Text style={[type.mono, { color: line.accent === 'live' ? colors.liveText : line.accent === 'fail' ? colors.failText : colors.agentText }]}>
              <Text style={{ color: line.accent ? undefined : colors.agentPrompt }}>{`${line.prefix} `}</Text>
              {line.text}
            </Text>
          </View>
        ))}
      </AgentWell>
      <HoldActions run={run} ticketId={ticketId} testID="stopped-actions" />
      <Text style={[type.caption, { color: colors.textFaintSolid }]}>{copy.helper}</Text>
    </Card>
  )
}

/** "This run" — the latest run's vitals in mono. */
export function ThisRunCard({ run, now }: { run: ApiRun; now: number }) {
  const { colors } = useTheme()
  const accent = (a: 'live' | 'ok' | 'fail' | 'muted' | null) =>
    a === 'live' ? colors.liveText : a === 'ok' ? colors.okText : a === 'fail' ? colors.failText : a === 'muted' ? colors.textFaintSolid : colors.textMuted
  return (
    <Card testID="this-run-card" style={styles.card}>
      <CardHeader title="This run" meta={runCardMeta(run, now)} />
      <View style={styles.lines}>
        {runCardLines(run, now).map((line) => (
          <Text key={line.text} style={[type.monoSmall, { color: accent(line.accent) }]}>
            {line.text}
          </Text>
        ))}
      </View>
    </Card>
  )
}

export function AttemptsCard({ runs, onOpen }: { runs: ApiRun[]; onOpen: (runId: number) => void }) {
  const { colors } = useTheme()
  const rows = attemptRows(runs)
  return (
    <Card testID="attempts-card" style={styles.card}>
      <CardHeader title="Attempts" meta={`${runs.length}`} />
      <View style={styles.lines}>
        {rows.map((row) => (
          <Text key={row.runId} testID={`attempt-row-${row.runId}`} style={[type.monoSmall, { color: colors.textMuted }]} onPress={() => onOpen(row.runId)}>
            <Text style={{ color: colors.text }}>{row.primary}</Text>
            {` · ${row.detail}`}
          </Text>
        ))}
      </View>
    </Card>
  )
}

export function LinkedCard({
  followUpOf,
  followUps,
  onOpen,
}: {
  followUpOf: ApiTicketDetail['followUpOf']
  followUps: ApiTicketDetail['followUps']
  onOpen: (ticketId: number) => void
}) {
  const { colors } = useTheme()
  if (!followUpOf && followUps.length === 0) return null
  return (
    <Card testID="linked-card" style={styles.card}>
      <CardHeader title="Linked" />
      <View style={styles.lines}>
        {followUpOf ? (
          <View style={styles.linked}>
            <Text style={[type.monoCaps, styles.caps, { color: colors.liveText }]}>follow-up of</Text>
            <Text testID={`linked-parent-${followUpOf.id}`} style={[type.bodyStrong, { color: colors.text }]} onPress={() => onOpen(followUpOf.id)}>
              {followUpOf.title}
            </Text>
          </View>
        ) : null}
        {followUps.map((f) => (
          <View key={f.id} style={styles.linked}>
            <Text style={[type.monoCaps, styles.caps, { color: colors.liveText }]}>follow-up</Text>
            <Text testID={`linked-followup-${f.id}`} style={[type.bodyStrong, { color: colors.text }]} onPress={() => onOpen(f.id)}>
              {f.title}
            </Text>
            <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>
              {f.proposalState === 'pending' ? 'proposed by agent · waiting on your keep' : 'in backlog'}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  )
}

export function IfYouDenyCard() {
  const { colors } = useTheme()
  return (
    <Card testID="if-you-deny-card" style={styles.card}>
      <CardHeader title="If you deny" />
      <Text style={[type.caption, { color: colors.textMuted }]}>
        It keeps everything it has done and takes your note as the next instruction. Denying is a redirection, not a restart.
      </Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  cardHeader: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  spacer: { flex: 1 },
  well: {
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    gap: space.xs,
  },
  wellLine: {},
  lines: { gap: space.xs },
  linked: { gap: 2 },
  caps: { textTransform: 'uppercase' },
})
