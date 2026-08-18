import type { ApiRepoDiff } from '@tada/shared'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ApiError } from '../../../src/api/client'
import { useRun, useRunDiff, useSources } from '../../../src/api/queries'
import { HoldActions } from '../../../src/components/gate/HoldActions'
import { AgentPanel, AppHeader, Badge, Button, EmptyState, Screen, Skeleton, Tag } from '../../../src/components/ui'
import { useTheme } from '../../../src/design/ThemeContext'
import { radius, space, type } from '../../../src/design/tokens'
import { goBackOr } from '../../../src/nav'
import { atPublishGate } from '../../../src/runActivity'

export default function DiffScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const runId = Number(id)
  if (Number.isNaN(runId)) return <NotHere reason="This run doesn't exist." runId={undefined} />
  return <DiffBody runId={runId} />
}

function NotHere({ reason, runId }: { reason: string; runId: number | undefined }) {
  const router = useRouter()
  return (
    <Screen testID="diff-not-gated">
      <AppHeader title="Diff" back backHref={runId !== undefined ? `/runs/${runId}` : '/'} />
      <EmptyState
        icon="git-branch"
        message={reason}
        action={{
          label: runId !== undefined ? 'Back to the run' : 'Back to Control',
          onPress: () => goBackOr(router, runId !== undefined ? `/runs/${runId}` : '/'),
        }}
      />
    </Screen>
  )
}

/** One patch line coloured by its first character: `+` raised, `−` struck and dim, `@@` muted. */
function PatchLine({ line }: { line: string }) {
  const { colors } = useTheme()
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return (
      <Text style={[type.mono, styles.patchLine, styles.added, { backgroundColor: colors.raised2, borderLeftColor: colors.textFaintSolid, color: colors.agentText }]}>
        {line}
      </Text>
    )
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return <Text style={[type.mono, styles.patchLine, styles.removed, { color: colors.agentTextMuted }]}>{`−${line.slice(1)}`}</Text>
  }
  const muted = line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')
  return <Text style={[type.mono, styles.patchLine, { color: muted ? colors.agentTextMuted : colors.agentText }]}>{line}</Text>
}

function DiffBody({ runId }: { runId: number }) {
  const router = useRouter()
  const { colors } = useTheme()
  const { data: run, error } = useRun(runId)
  const gated = atPublishGate(run)
  const { data: diff, isLoading, error: diffError } = useRunDiff(runId, gated)
  const { data: sources } = useSources()

  const files = useMemo(
    () => (diff?.repos ?? []).flatMap((repo) => repo.files.map((file) => ({ repo, file }))),
    [diff],
  )
  const [current, setCurrent] = useState(0)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /input|textarea/i.test(target.tagName)) return
      if (e.key === 'j') setCurrent((c) => Math.min(files.length - 1, c + 1))
      if (e.key === 'k') setCurrent((c) => Math.max(0, c - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [files.length])

  if (error instanceof ApiError && error.status === 404) return <NotHere reason="This run doesn't exist." runId={undefined} />
  if (run && !gated) {
    return <NotHere reason="The diff appears only at a publish gate — this run isn't at one. The transcript is the view of work in progress." runId={runId} />
  }
  if (diffError instanceof ApiError && diffError.status === 409) {
    return <NotHere reason="The diff appears only at a publish gate — this run isn't at one." runId={runId} />
  }

  const hold = run?.hold?.reason === 'permission' ? run.hold : null
  const heldAt = hold ? hold.summary.split('\n')[0] : ''
  const touched = new Set((diff?.repos ?? []).map((r) => r.repo))
  const untouched = (sources ?? []).filter((s) => !touched.has(s.name))

  return (
    <Screen edges={['top', 'bottom']} testID="diff-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Button testID="diff-back" variant="ghost" small icon="chevron-left" label="Run" onPress={() => goBackOr(router, `/runs/${runId}`)} />
          <View style={styles.headerTitleBlock}>
            <Text style={[type.title, { color: colors.text }]}>Diff before it exists on github</Text>
            <Text testID="diff-meta" style={[type.monoSmall, { color: colors.textFaintSolid }]}>
              {run ? `run #${run.id} · held at ${heldAt}` : '…'}
            </Text>
          </View>
          <View style={styles.spacer} />
          <Badge status="live" label="local only" />
        </View>

        <Text style={[type.caption, { color: colors.textMuted }]}>
          A run works out of your folder, in a git worktree per repo it touches — each on its own branch. The diff is
          <Text style={[type.monoSmall, { color: colors.textMuted }]}>{` git diff ${diff?.repos[0]?.defaultBranch ?? 'main'}...${diff?.repos[0]?.branch ?? `ticket/${run?.ticketId ?? '…'}`} `}</Text>
          — no pull request needed. The held call names its repo, so the gate opens straight to it.
        </Text>

        {isLoading || !diff ? (
          <View style={styles.repos}>
            <Skeleton height={40} />
            <Skeleton height={40} />
          </View>
        ) : (
          <View style={styles.repos}>
            {diff.repos.map((repo, i) => (
              <RepoRow key={repo.repo} repo={repo} heldCall={i === 0} />
            ))}
            {untouched.map((s) => (
              <View key={s.name} testID={`diff-untouched-${s.name}`} style={[styles.repoRow, styles.dashed, { borderColor: colors.borderSubtle }]}>
                <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>
                  {s.type === 'folder' ? `${s.path} · read only · untouched` : `${s.name} · untouched`}
                </Text>
              </View>
            ))}
            {diff.repos.length === 0 ? (
              <Text testID="diff-empty" style={[type.caption, { color: colors.textFaintSolid }]}>
                No branch is ahead of its default — nothing to publish yet.
              </Text>
            ) : null}
          </View>
        )}

        {files.map(({ repo, file }, i) => (
          <View key={`${repo.repo}/${file.path}`} testID={`diff-file-${i}`} style={i === current && files.length > 1 ? [styles.currentFile, { borderColor: colors.live }] : undefined}>
            <AgentPanel header={`${repo.repo} · ${file.path}`} meta={`${i + 1} of ${files.length} · +${file.additions} −${file.deletions}`}>
              {file.patch
                .split('\n')
                .filter((l) => l !== '')
                .map((line, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: patch lines are positional
                  <PatchLine key={j} line={line} />
                ))}
            </AgentPanel>
          </View>
        ))}

        {run ? (
          <View style={styles.actionsRow}>
            <HoldActions run={run} ticketId={run.ticketId} testID="diff-actions" />
            <View style={styles.spacer} />
            {Platform.OS === 'web' ? (
              <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>j / k between files</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

function RepoRow({ repo, heldCall }: { repo: ApiRepoDiff; heldCall: boolean }) {
  const { colors, shadow } = useTheme()
  return (
    <View
      testID={`diff-repo-${repo.repo}`}
      style={[
        styles.repoRow,
        heldCall ? shadow.card : undefined,
        { backgroundColor: colors.raised, borderColor: heldCall ? colors.borderStrong : colors.borderSubtle, opacity: heldCall ? 1 : 0.85 },
      ]}
    >
      <Text style={[type.monoSmall, { color: colors.text }]}>{repo.repo}</Text>
      {heldCall ? <Tag label="the held call" /> : null}
      <View style={styles.spacer} />
      <Text style={[type.monoSmall, { color: colors.textFaintSolid }]}>
        {`${repo.defaultBranch} ← ${repo.branch} · ${repo.files.length} ${repo.files.length === 1 ? 'file' : 'files'} · +${repo.additions} −${repo.deletions}`}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  headerTitleBlock: { gap: 2 },
  spacer: { flex: 1 },
  repos: { gap: 6 },
  repoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 1,
  },
  dashed: { borderStyle: 'dashed' },
  patchLine: { lineHeight: 22 },
  added: { borderLeftWidth: 2, paddingLeft: 8, marginLeft: -10 },
  removed: { textDecorationLine: 'line-through', opacity: 0.6 },
  currentFile: { borderWidth: 1, borderRadius: radius.control },
  actionsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
})
