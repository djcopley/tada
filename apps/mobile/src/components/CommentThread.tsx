import type { ApiComment } from '@tada/shared'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

const URL_REGEX = /https?:\/\/\S+/g

/** Splits a comment body on bare URLs, rendering each URL as a tappable
 * span. Full markdown link rendering (`[text](url)`) is deferred — this
 * covers the common case of a pasted link. */
function CommentBody({ body }: { body: string }) {
  const matches = [...body.matchAll(URL_REGEX)]
  if (matches.length === 0) return <Text style={styles.bubbleText}>{body}</Text>

  const nodes: ReactNode[] = []
  let cursor = 0
  matches.forEach((match, i) => {
    const url = match[0]
    const start = match.index ?? 0
    if (start > cursor) nodes.push(<Text key={`t-${i}`}>{body.slice(cursor, start)}</Text>)
    nodes.push(
      <Text key={`u-${i}`} style={styles.link} onPress={() => void Linking.openURL(url)}>
        {url}
      </Text>,
    )
    cursor = start + url.length
  })
  if (cursor < body.length) nodes.push(<Text key="t-end">{body.slice(cursor)}</Text>)

  return <Text style={styles.bubbleText}>{nodes}</Text>
}

export function CommentThread({
  comments,
  onSend,
  sending,
}: {
  comments: ApiComment[]
  onSend: (body: string) => void
  sending?: boolean
}) {
  const [draft, setDraft] = useState('')
  const sorted = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const send = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    onSend(trimmed)
    setDraft('')
  }

  return (
    <View style={styles.container}>
      <FlatList
        testID="comment-thread"
        data={sorted}
        keyExtractor={(c) => String(c.id)}
        scrollEnabled={false}
        renderItem={({ item }) => (
          <View
            testID={`comment-${item.id}`}
            style={[styles.bubble, item.author === 'human' ? styles.humanBubble : styles.agentBubble]}
          >
            <Text style={styles.author}>{item.author === 'human' ? 'you' : 'agent'}</Text>
            <CommentBody body={item.body} />
          </View>
        )}
      />
      <View style={styles.inputRow}>
        <TextInput
          testID="comment-input"
          style={styles.input}
          placeholder="Write a comment"
          value={draft}
          onChangeText={setDraft}
        />
        <Pressable
          testID="comment-send"
          style={[styles.sendButton, sending && styles.disabled]}
          onPress={send}
          disabled={sending}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 10,
    padding: 10,
    marginVertical: 4,
    gap: 2,
  },
  agentBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#f0f0f0',
  },
  humanBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#e0f0ff',
  },
  author: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
  },
  bubbleText: {
    fontSize: 14,
  },
  link: {
    color: '#1565c0',
    textDecorationLine: 'underline',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
    borderRadius: 6,
    padding: 10,
  },
  sendButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#1565c0',
  },
  disabled: {
    opacity: 0.5,
  },
  sendText: {
    color: '#fff',
    fontWeight: '600',
  },
})
