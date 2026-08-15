import type { ApiRun } from '@tada/shared'
import { StyleSheet, Text, View } from 'react-native'
import type { AttemptRow, LinkedFollowUp } from '../../ticketDetail'
import { FOLLOW_UP_META, REVIEW_ACCEPT_HELPER_COPY, reviewStatLine } from '../../ticketDetail'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { TadaStar } from '../ui/TadaStar'

/** Small sans title + mono meta header above a Card's body — Card itself is a bare surface, so
 * every screen that wants the artboard's `title`/`meta` Card header composes it locally. */
export function CardHeader({ title, meta }: { title?: string; meta?: string }) {
  const { colors } = useTheme()
  if (!title && !meta) return null
  return (
    <View style={styles.header}>
      {title ? <Text style={[type.bodyStrong, styles.headerTitle, { color: colors.text }]}>{title}</Text> : null}
      {meta ? <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{meta}</Text> : null}
    </View>
  )
}

export function ReviewCard({
  run,
  agoLabel,
  accepting,
  celebrate,
  onAccept,
  onSendBack,
  onOpenPr,
  testID,
}: {
  run: ApiRun
  agoLabel: string
  accepting: boolean
  celebrate: boolean
  onAccept: () => void
  onSendBack: () => void
  onOpenPr: () => void
  testID: string
}) {
  const { colors } = useTheme()
  const statLine = reviewStatLine(run)
  return (
    <Card testID={testID} style={styles.card}>
      <CardHeader title="Your review is needed" meta={agoLabel} />
      <View style={[styles.agentWell, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}>
        <Text style={[type.mono, { color: colors.agentText }]}>
          <Text style={{ color: colors.agentPrompt }}>{'▸ '}</Text>
          {run.summary ?? 'no summary yet'}
        </Text>
        {statLine ? <Text style={[type.mono, { color: colors.agentTextMuted }]}>{statLine}</Text> : null}
      </View>
      <View style={styles.actionsRow}>
        <Button testID={`${testID}-accept`} variant="primary" small label="Accept run" loading={accepting} onPress={onAccept} />
        <Button testID={`${testID}-send-back`} variant="ghost" small label="Send back" onPress={onSendBack} />
        {run.prUrl ? <Button testID={`${testID}-open-pr`} variant="ghost" small label="Open pr" onPress={onOpenPr} /> : null}
        {celebrate ? <TadaStar play testID={`${testID}-tada`} /> : null}
      </View>
      <Text style={[type.caption, styles.helperCopy, { color: colors.textFaintSolid }]}>{REVIEW_ACCEPT_HELPER_COPY}</Text>
    </Card>
  )
}

export function AttemptsCard({ rows, testID }: { rows: AttemptRow[]; testID: string }) {
  const { colors } = useTheme()
  if (rows.length === 0) return null
  return (
    <Card testID={testID} style={styles.card}>
      <CardHeader title="Attempts" />
      <View style={styles.attemptsList}>
        {rows.map((row) => (
          <View key={row.id} testID={`${testID}-row-${row.id}`}>
            <Text style={[type.mono, { color: row.current ? colors.okText : colors.textMuted }]}>{row.primary}</Text>
            {row.detail ? <Text style={[type.mono, { color: colors.textFaintSolid }]}>{row.detail}</Text> : null}
            {row.quote ? <Text style={[type.mono, { color: colors.textFaintSolid }]}>{row.quote}</Text> : null}
          </View>
        ))}
      </View>
    </Card>
  )
}

export function LinkedCard({ followUps, testID }: { followUps: LinkedFollowUp[]; testID: string }) {
  const { colors } = useTheme()
  if (followUps.length === 0) return null
  return (
    <Card testID={testID} style={styles.card}>
      <CardHeader title="Linked" />
      <View style={styles.linkedList}>
        {followUps.map((f) => (
          <View key={f.id} testID={`${testID}-item-${f.id}`}>
            <Text style={[type.monoCaps, styles.caps, { color: colors.liveText }]}>{'Follow-up'}</Text>
            <Text style={[type.caption, styles.linkedTitle, { color: colors.text }]}>{f.title}</Text>
            <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{FOLLOW_UP_META}</Text>
          </View>
        ))}
      </View>
    </Card>
  )
}

export function MemoryReadCard({
  keptTitles,
  highlighted,
  testID,
}: {
  keptTitles: string[]
  highlighted?: string
  testID: string
}) {
  const { colors } = useTheme()
  if (keptTitles.length === 0 && !highlighted) return null
  return (
    <Card testID={testID} style={styles.card}>
      <CardHeader title="Memory it read" />
      <Text style={[type.mono, { color: colors.textMuted }]}>
        {keptTitles.map((title, i) => (
          <Text key={i}>{i > 0 ? ` · ${title}` : title}</Text>
        ))}
        {highlighted ? (
          <Text style={{ color: colors.okText }}>{keptTitles.length > 0 ? ` · ${highlighted}` : highlighted}</Text>
        ) : null}
      </Text>
    </Card>
  )
}

export function SendItBackCard({ copy, testID }: { copy: string; testID: string }) {
  const { colors } = useTheme()
  return (
    <Card testID={testID} style={styles.card}>
      <CardHeader title="If you send it back" />
      <Text style={[type.caption, styles.sendBackCopy, { color: colors.textMuted }]}>{copy}</Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm + 2,
  },
  header: {
    gap: 2,
  },
  headerTitle: {
    flexShrink: 1,
  },
  agentWell: {
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    gap: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  helperCopy: {
    lineHeight: 18,
  },
  attemptsList: {
    gap: space.sm + 2,
  },
  linkedList: {
    gap: space.md,
  },
  caps: {
    textTransform: 'uppercase',
  },
  linkedTitle: {
    fontWeight: '500',
    marginTop: 2,
  },
  sendBackCopy: {
    lineHeight: 19,
  },
})
