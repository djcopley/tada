import type { ApiMemoryNote } from '@tada/shared'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useDismissNote, useKeepNote, useMemory } from '../../api/queries'
import { hhmm } from '../../control'
import { useTheme } from '../../design/ThemeContext'
import { space, type } from '../../design/tokens'
import { useLayout } from '../../layout'
import { plainTextLinks } from '../../linkify'
import { bareAge } from '../../relativeTime'
import { AgentPanel, Button, Card, Dialog, EmptyState, Screen, Skeleton, Tag } from '../ui'

const DAY_MS = 24 * 60 * 60 * 1000

/** `HH:MM` for a note proposed today, otherwise the coarser `2w`-style bucket — the artboard's
 * `by agent · 07:58` for a note learned today, a bare age for older ones. */
export function noteAge(iso: string, now: number = Date.now()): string {
  return now - new Date(iso).getTime() < DAY_MS ? hhmm(iso) : bareAge(iso, now)
}

/** Card meta for a kept note: an untagged note rides on every run ("global · every run"); a
 * tagged one shows who last touched it and when ("edited by you · 2w" / "by agent · 5d"). */
export function keptNoteMeta(note: Pick<ApiMemoryNote, 'tags' | 'author' | 'updatedAt'>, now: number = Date.now()): string {
  if (note.tags.length === 0) return 'global · every run'
  const who = note.author === 'human' ? 'edited by you' : 'by agent'
  return `${who} · ${bareAge(note.updatedAt, now)}`
}

/** "keeping tags it parlor-api" — the hint under a proposed note's Keep/Dismiss, or null when
 * the proposal is untagged (keeping it makes it global). */
export function keepHint(tags: string[]): string | null {
  return tags.length ? `keeping tags it ${tags.join(', ')}` : null
}

/** One list, no scopes: every kept note as a card, agent proposals as agent panels awaiting
 * keep/dismiss. Rail/BottomStrip are drawn by the tabs frame. */
export function MemoryListScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { wide } = useLayout()

  const memory = useMemory()
  const keepNote = useKeepNote()
  const dismissNote = useDismissNote()
  const [dismissTarget, setDismissTarget] = useState<ApiMemoryNote | null>(null)

  const notes = memory.data ?? []
  const kept = notes.filter((n) => n.state === 'kept')
  const pending = notes.filter((n) => n.state === 'pending')

  const confirmDismiss = () => {
    const target = dismissTarget
    setDismissTarget(null)
    if (target) dismissNote.mutate(target.id)
  }

  const header = (
    <View style={styles.headerRow}>
      <Text style={[wide ? type.display : type.title, { color: colors.text }]}>Memory</Text>
      {memory.data ? (
        <Text testID="memory-count" style={[type.monoSmall, { color: colors.textFaintSolid }]}>
          {`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
        </Text>
      ) : null}
      <View style={styles.spacer} />
      <Button testID="memory-add-button" variant="primary" small label="New note" onPress={() => router.push('/notes/new')} />
    </View>
  )

  const explainer = (
    <Text style={[type.caption, styles.intro, { color: colors.textMuted }]}>
      The agent reads every matching note before a run — and may propose its own. Plain text, edit freely.
    </Text>
  )

  let body: React.ReactNode
  if (memory.isError) {
    body = <EmptyState icon="alert-circle" message="Could not load memory." action={{ label: 'Retry', onPress: () => void memory.refetch() }} />
  } else if (memory.isLoading || !memory.data) {
    body = (
      <View style={styles.skeletons}>
        <Skeleton height={92} />
        <Skeleton height={92} />
        <Skeleton height={92} />
      </View>
    )
  } else if (notes.length === 0) {
    body = (
      <EmptyState
        testID="memory-empty"
        icon="book-open"
        message="No notes yet. Write what a new colleague should know — conventions, gotchas, how you test."
        action={{ label: 'Write the first note', onPress: () => router.push('/notes/new') }}
      />
    )
  } else {
    body = (
      <>
        {kept.map((n) => (
          <Card key={n.id} testID={`memory-note-${n.id}`} onPress={() => router.push(`/notes/${n.id}`)} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={[type.bodyStrong, styles.cardTitle, { color: colors.text }]}>{n.title}</Text>
              <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{keptNoteMeta(n)}</Text>
            </View>
            {n.body.trim() ? (
              <Text numberOfLines={4} style={[type.monoSmall, { color: colors.textMuted }]}>
                {plainTextLinks(n.body)}
              </Text>
            ) : (
              <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>empty</Text>
            )}
            {n.tags.length > 0 ? (
              <View style={styles.tagsRow}>
                {n.tags.map((t) => (
                  <Tag key={t} label={t} />
                ))}
              </View>
            ) : null}
          </Card>
        ))}

        {pending.map((n) => (
          <View key={n.id} style={styles.pendingBlock}>
            <AgentPanel testID={`memory-pending-${n.id}`} header={`proposed: ${n.title}`} meta={`by agent · ${noteAge(n.updatedAt)}`}>
              <Text style={[type.mono, { color: colors.agentText }]}>{n.body}</Text>
            </AgentPanel>
            <View style={styles.actionsRow}>
              <Button
                testID={`memory-pending-${n.id}-keep`}
                variant="secondary"
                small
                label="Keep"
                loading={keepNote.isPending && keepNote.variables === n.id}
                onPress={() => keepNote.mutate(n.id)}
              />
              <Button testID={`memory-pending-${n.id}-dismiss`} variant="ghost" small label="Dismiss" onPress={() => setDismissTarget(n)} />
              {keepHint(n.tags) ? (
                <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{keepHint(n.tags)}</Text>
              ) : null}
            </View>
          </View>
        ))}
      </>
    )
  }

  const dialog = (
    <Dialog
      visible={dismissTarget !== null}
      title="Dismiss note?"
      onClose={() => setDismissTarget(null)}
      testID="memory-dismiss-dialog"
      confirm={{
        label: 'Dismiss',
        destructive: true,
        onPress: confirmDismiss,
        loading: dismissNote.isPending,
        testID: 'memory-dismiss-confirm',
      }}
    >
      <Text style={[type.body, { color: colors.textMuted }]}>
        {`"${dismissTarget?.title ?? ''}" is deleted — the agent won't see it again.`}
      </Text>
    </Dialog>
  )

  if (wide) {
    return (
      <View style={[styles.wideRoot, { backgroundColor: colors.ground }]} testID="memory-wide">
        <ScrollView contentContainerStyle={styles.wideContent}>
          <View style={styles.column}>
            {header}
            {explainer}
            {body}
          </View>
        </ScrollView>
        {dialog}
      </View>
    )
  }

  return (
    <Screen testID="memory-narrow">
      <ScrollView contentContainerStyle={styles.narrowContent}>
        {header}
        {explainer}
        {body}
      </ScrollView>
      {dialog}
    </Screen>
  )
}

const styles = StyleSheet.create({
  wideRoot: { flex: 1 },
  wideContent: { flexGrow: 1, alignItems: 'center', padding: space.xxl },
  column: { width: '100%', maxWidth: 680, gap: space.md },
  narrowContent: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  spacer: { flex: 1 },
  intro: { lineHeight: 19, marginTop: -space.xs },
  skeletons: { gap: space.md },
  card: { gap: space.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  cardTitle: { flexShrink: 1 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pendingBlock: { gap: space.sm },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
})
