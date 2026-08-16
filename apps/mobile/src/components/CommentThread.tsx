import type { ApiComment } from '@tada/shared'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTheme } from '../design/ThemeContext'
import { radius, space, type } from '../design/tokens'
import { splitLinks } from '../linkify'
import { relativeTime } from '../relativeTime'
import { Icon } from './ui/Icon'

/** Splits a comment body on links — markdown `[label](url)` (attach_link) and bare pasted URLs
 * — rendering each as a tappable span (see linkify.ts). */
function CommentBody({
  body,
  commentId,
  color,
  linkColor,
  mono = false,
  prefix,
  suffix,
}: {
  body: string
  commentId: number
  color: string
  linkColor: string
  /** Agent comments render in the mono voice. */
  mono?: boolean
  /** Sans prefix before the body — feedback comments read "sent back: …". */
  prefix?: ReactNode
  /** Trailing node after the body — nudge comments get a mono " (nudge)" marker. */
  suffix?: ReactNode
}) {
  const bodyStyle = [mono ? type.mono : type.body, { color }]
  const segments = splitLinks(body)
  if (!segments.some((seg) => seg.kind === 'link')) {
    return (
      <Text style={bodyStyle}>
        {prefix}
        {body}
        {suffix}
      </Text>
    )
  }

  let linkIndex = 0
  const nodes: ReactNode[] = segments.map((seg, i) => {
    if (seg.kind === 'text') return <Text key={`t-${i}`}>{seg.text}</Text>
    const n = linkIndex++
    return (
      <Text
        key={`u-${i}`}
        testID={`comment-link-${commentId}-${n}`}
        style={[styles.link, { color: linkColor }]}
        onPress={() => void Linking.openURL(seg.url)}
      >
        {seg.label}
      </Text>
    )
  })

  return (
    <Text style={bodyStyle}>
      {prefix}
      {nodes}
      {suffix}
    </Text>
  )
}

export function CommentThread({
  comments,
  onSend,
  sending,
}: {
  comments: ApiComment[]
  /** May resolve/reject to report the outcome; the draft is only cleared on
   * success so a failed send leaves the user's text in place to retry. A
   * fire-and-forget `void`-returning `onSend` is also accepted, in which
   * case the draft clears immediately (unchanged from prior behavior). */
  onSend: (body: string) => void | Promise<void>
  sending?: boolean
}) {
  const { colors } = useTheme()
  const [draft, setDraft] = useState('')
  const sorted = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const send = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    Promise.resolve(onSend(trimmed))
      .then(() => setDraft(''))
      .catch(() => {
        // Keep the draft text so the user can retry; the global mutation
        // error handler already surfaces a toast for the failure.
      })
  }

  return (
    <View style={styles.container}>
      {/* A plain map, not a FlatList: this thread sits inside the ticket screen's ScrollView, and a
          same-orientation VirtualizedList nested in a ScrollView warns on every mount (and can't
          virtualize there anyway). */}
      <View testID="comment-thread">
        {sorted.map((item) => {
          const human = item.author === 'human'
          if (human) {
            return (
              <View
                key={item.id}
                testID={`comment-${item.id}`}
                style={[
                  styles.bubble,
                  { backgroundColor: colors.raised, borderColor: colors.borderSubtle },
                ]}
              >
                <Text style={[type.caption, { color: colors.text }]}>
                  You
                  <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>
                    {`  ${relativeTime(item.createdAt)}`}
                  </Text>
                </Text>
                <CommentBody
                  body={item.body}
                  commentId={item.id}
                  color={colors.textMuted}
                  linkColor={colors.liveText}
                  prefix={item.kind === 'feedback' ? 'sent back: ' : undefined}
                  suffix={
                    item.kind === 'nudge' ? (
                      <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>{' (nudge)'}</Text>
                    ) : undefined
                  }
                />
              </View>
            )
          }
          // The agent's voice: mono on recessed ink with the ▸ prompt.
          return (
            <View
              key={item.id}
              testID={`comment-${item.id}`}
              style={[
                styles.bubble,
                { backgroundColor: colors.agentSurface, borderColor: colors.agentSurfaceEdge },
              ]}
            >
              <Text style={[type.mono, { color: colors.agentText }]}>
                <Text style={{ color: colors.agentPrompt }}>{'▸ '}</Text>
                <CommentBody
                  body={item.body}
                  commentId={item.id}
                  color={colors.agentText}
                  linkColor={colors.liveText}
                  mono
                />
                <Text style={{ color: colors.agentTextMuted }}>{` · ${relativeTime(item.createdAt)}`}</Text>
              </Text>
            </View>
          )
        })}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          testID="comment-input"
          style={[
            styles.input,
            type.body,
            { color: colors.text, backgroundColor: colors.controlBg, borderColor: colors.controlBorder },
          ]}
          placeholder="Add a note — the agent reads the thread on its next attempt"
          placeholderTextColor={colors.textFaintSolid}
          multiline
          value={draft}
          onChangeText={setDraft}
        />
        <Pressable
          testID="comment-send"
          accessibilityRole="button"
          accessibilityLabel="Send comment"
          style={({ pressed }) => [
            styles.sendButton,
            { backgroundColor: colors.primaryBg },
            (sending || pressed) && { opacity: 0.6 },
          ]}
          onPress={send}
          disabled={sending}
        >
          <Icon name="arrow-up" size={18} color={colors.primaryText} />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: space.sm,
  },
  bubble: {
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: space.md + 1,
    paddingVertical: space.sm + 1,
    marginVertical: space.xs,
    gap: space.xs,
  },
  link: {
    textDecorationLine: 'underline',
  },
  inputRow: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 44,
    maxHeight: 120,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
