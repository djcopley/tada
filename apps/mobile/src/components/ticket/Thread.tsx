import type { ApiComment, ApiRun } from '@tada/shared'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../design/ThemeContext'
import { radius, space, type } from '../../design/tokens'
import { splitLinks } from '../../linkify'
import { relativeTime } from '../../relativeTime'
import { elapsedLabel } from '../../control'
import { holdThreadLine, notePlaceholder } from '../../ticketDetail'
import { Button, Input } from '../ui'

/** Renders a body with markdown `[label](url)` / bare URLs as tappable spans (see linkify.ts). */
function LinkedBody({ body, commentId, color, linkColor, mono }: { body: string; commentId: number; color: string; linkColor: string; mono?: boolean }) {
  const style = [mono ? type.mono : type.body, { color }]
  const segments = splitLinks(body)
  if (!segments.some((s) => s.kind === 'link')) return <Text style={style}>{body}</Text>
  let n = 0
  const nodes: ReactNode[] = segments.map((seg, i) => {
    if (seg.kind === 'text') return <Text key={`t-${i}`}>{seg.text}</Text>
    const k = n++
    return (
      <Text key={`u-${i}`} testID={`comment-link-${commentId}-${k}`} style={[styles.link, { color: linkColor }]} onPress={() => void Linking.openURL(seg.url)}>
        {seg.label}
      </Text>
    )
  })
  return <Text style={style}>{nodes}</Text>
}

type Props = {
  comments: ApiComment[]
  /** The latest run — its hold (if any) is the thread's last, orange line. */
  run: ApiRun | null
  now: number
  onSend: (body: string) => Promise<void>
  sending?: boolean
}

/**
 * The ticket thread: agent lines on recessed mono, your notes on raised sans, the current hold as
 * an orange agent line, then the note input. Every free-text thing you send the agent is a note.
 */
export function Thread({ comments, run, now, onSend, sending = false }: Props) {
  const { colors } = useTheme()
  const [draft, setDraft] = useState('')

  const send = async () => {
    const body = draft.trim()
    if (!body) return
    await onSend(body)
    setDraft('')
  }

  const holdLine = run ? holdThreadLine(run) : null

  return (
    <View testID="ticket-thread" style={styles.root}>
      <Text style={[type.monoCaps, styles.caps, { color: colors.textFaintSolid }]}>Thread</Text>
      {comments.length === 0 && !holdLine ? (
        <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>nothing yet — the agent posts here as it works, and your notes land here too</Text>
      ) : null}
      {comments.map((c) =>
        c.author === 'agent' ? (
          <View key={c.id} testID={`thread-agent-${c.id}`} style={[styles.agentLine, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}>
            <Text style={[type.mono, { color: colors.agentText }]}>
              <Text style={{ color: colors.agentPrompt }}>{'▸ '}</Text>
              <LinkedBody body={c.body} commentId={c.id} color={colors.agentText} linkColor={colors.liveText} mono />
              <Text style={{ color: colors.agentTextMuted }}>{` · ${relativeTime(c.createdAt)}`}</Text>
            </Text>
          </View>
        ) : (
          <View key={c.id} testID={`thread-note-${c.id}`} style={[styles.humanLine, { backgroundColor: colors.raised, borderColor: colors.borderSubtle }]}>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              <Text style={[type.bodyStrong, { color: colors.text }]}>You</Text>
              {' — note: '}
              <LinkedBody body={c.body} commentId={c.id} color={colors.textMuted} linkColor={colors.liveText} />
              <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{`  ${relativeTime(c.createdAt)}`}</Text>
            </Text>
          </View>
        ),
      )}
      {holdLine && run ? (
        <View testID="thread-hold-line" style={[styles.agentLine, { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge }]}>
          <Text style={[type.mono, { color: colors.liveText }]}>
            {'⏸ '}
            {holdLine}
            <Text style={{ color: colors.agentTextMuted }}>{` · ${elapsedLabel(run.heldAt ?? run.startedAt, now)}`}</Text>
          </Text>
        </View>
      ) : null}
      <View style={styles.composer}>
        <Input
          testID="note-input"
          value={draft}
          onChangeText={setDraft}
          placeholder={notePlaceholder(run)}
          multiline
          containerStyle={styles.composerInput}
        />
        <Button testID="note-send" label="Send" variant="secondary" disabled={draft.trim().length === 0} loading={sending} onPress={() => void send()} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  caps: { textTransform: 'uppercase' },
  agentLine: {
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 1,
  },
  humanLine: {
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 1,
  },
  link: { textDecorationLine: 'underline' },
  composer: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    marginTop: space.xs,
  },
  composerInput: { flex: 1 },
})
