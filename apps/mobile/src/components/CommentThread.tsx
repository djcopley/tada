import type { ApiComment } from '@tada/shared'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTheme } from '../design/ThemeContext'
import { radius, space, type } from '../design/tokens'
import { relativeTime } from '../relativeTime'
import { Icon } from './ui'

const URL_REGEX = /https?:\/\/\S+/g
const TRAILING_PUNCTUATION = '.,;:!?]}'

/**
 * `\S+` greedily swallows trailing punctuation that's actually sentence
 * structure, not part of the URL ("...(https://x.com/foo)." would otherwise
 * link to "foo).") . Strip trailing punctuation off the match; `)` is only
 * stripped when the match itself contains no `(`, so a URL whose path
 * legitimately balances parens (e.g. a Wikipedia link) is left alone.
 */
function trimTrailingPunctuation(url: string): { clean: string; trailing: string } {
  const hasOpenParen = url.includes('(')
  let end = url.length
  while (end > 0) {
    const ch = url.charAt(end - 1)
    if (ch === ')') {
      if (hasOpenParen) break
      end -= 1
      continue
    }
    if (TRAILING_PUNCTUATION.includes(ch)) {
      end -= 1
      continue
    }
    break
  }
  return { clean: url.slice(0, end), trailing: url.slice(end) }
}

/** Splits a comment body on bare URLs, rendering each URL as a tappable
 * span. Full markdown link rendering (`[text](url)`) is deferred — this
 * covers the common case of a pasted link. */
function CommentBody({
  body,
  commentId,
  color,
  linkColor,
}: {
  body: string
  commentId: number
  color: string
  linkColor: string
}) {
  const bodyStyle = [type.body, { color }]
  const matches = [...body.matchAll(URL_REGEX)]
  if (matches.length === 0) return <Text style={bodyStyle}>{body}</Text>

  const nodes: ReactNode[] = []
  let cursor = 0
  matches.forEach((match, i) => {
    const raw = match[0]
    const start = match.index ?? 0
    if (start > cursor) nodes.push(<Text key={`t-${i}`}>{body.slice(cursor, start)}</Text>)
    const { clean, trailing } = trimTrailingPunctuation(raw)
    nodes.push(
      <Text
        key={`u-${i}`}
        testID={`comment-link-${commentId}-${i}`}
        style={[styles.link, { color: linkColor }]}
        onPress={() => void Linking.openURL(clean)}
      >
        {clean}
      </Text>,
    )
    if (trailing) nodes.push(<Text key={`p-${i}`}>{trailing}</Text>)
    cursor = start + raw.length
  })
  if (cursor < body.length) nodes.push(<Text key="t-end">{body.slice(cursor)}</Text>)

  return <Text style={bodyStyle}>{nodes}</Text>
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
      <FlatList
        testID="comment-thread"
        data={sorted}
        keyExtractor={(c) => String(c.id)}
        scrollEnabled={false}
        renderItem={({ item }) => {
          const human = item.author === 'human'
          return (
            <View
              testID={`comment-${item.id}`}
              style={[
                styles.bubble,
                human
                  ? [styles.humanBubble, { backgroundColor: colors.ink }]
                  : [styles.agentBubble, { backgroundColor: colors.surfaceAlt }],
              ]}
            >
              <View style={styles.bubbleHeader}>
                <Text style={[type.monoSmall, { color: human ? colors.onInk : colors.inkMuted }]}>
                  {human ? 'YOU' : 'AGENT'}
                </Text>
                <Text style={[type.monoSmall, { color: human ? colors.onInk : colors.inkFaint, opacity: 0.7 }]}>
                  {relativeTime(item.createdAt)}
                </Text>
              </View>
              <CommentBody
                body={item.body}
                commentId={item.id}
                color={human ? colors.onInk : colors.ink}
                linkColor={human ? colors.onInk : colors.signalViolet}
              />
            </View>
          )
        }}
      />
      <View style={styles.inputRow}>
        <TextInput
          testID="comment-input"
          style={[
            styles.input,
            type.body,
            { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.line },
          ]}
          placeholder="Write a comment"
          placeholderTextColor={colors.inkFaint}
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
            { backgroundColor: colors.ink },
            (sending || pressed) && { opacity: 0.6 },
          ]}
          onPress={send}
          disabled={sending}
        >
          <Icon name="arrow-up" size={18} color={colors.onInk} />
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
    maxWidth: '85%',
    borderRadius: radius.md,
    padding: space.md,
    marginVertical: space.xs,
    gap: space.xs,
  },
  agentBubble: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: radius.sm,
  },
  humanBubble: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: radius.sm,
  },
  bubbleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
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
    borderRadius: radius.md,
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
