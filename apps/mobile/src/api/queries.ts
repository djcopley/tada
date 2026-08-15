import type { ApiBoard, ApiTicket, ApiWorkspace } from '@tada/shared'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import type { AddSourceBody } from './client'
import { useClient } from './ClientContext'
import { loadActiveWorkspaceId, saveActiveWorkspaceId } from '../settings'

const CHECK_NAME_DEBOUNCE_MS = 300

/**
 * Applies a move/reorder to a cached board snapshot so the card lands
 * instantly; the server round-trip then reconciles via invalidation.
 */
function moveInBoard(
  board: ApiBoard,
  ticketId: number,
  to: { columnId?: number; position: number },
): ApiBoard {
  let moved: ApiTicket | undefined
  const stripped = board.columns.map((column) => {
    const ticket = column.tickets.find((t) => t.id === ticketId)
    if (!ticket) return column
    moved = ticket
    return { ...column, tickets: column.tickets.filter((t) => t.id !== ticketId) }
  })
  if (!moved) return board
  const targetId = to.columnId ?? moved.columnId
  return {
    ...board,
    columns: stripped.map((column) =>
      column.id === targetId
        ? {
            ...column,
            tickets: [...column.tickets, { ...moved!, columnId: targetId, position: to.position }],
          }
        : column,
    ),
  }
}

export const keys = {
  workspaces: ['workspaces'] as const,
  board: (id: number) => ['board', id] as const,
  ticket: (id: number) => ['ticket', id] as const,
  memory: (id: number) => ['memory', id] as const,
  globalMemory: ['memory', 'global'] as const,
  workspace: (id: number) => ['workspace', id] as const,
  run: (id: number) => ['run', id] as const,
  /** Bare `['activity']` is a prefix of every `activity(wsId)` key, so
   * invalidating it (as useWorkspaceSocket does) refreshes every activity
   * view — per-workspace and the cross-workspace "all" feed alike. */
  activity: (workspaceId?: number) =>
    workspaceId === undefined ? (['activity'] as const) : (['activity', workspaceId] as const),
  adapters: ['adapters'] as const,
  status: ['status'] as const,
  knownRepos: ['knownRepos'] as const,
  checkName: (name: string) => ['checkName', name] as const,
}

export function useWorkspaces() {
  const client = useClient()
  return useQuery({ queryKey: keys.workspaces, queryFn: () => client.listWorkspaces() })
}

export function useBoard(wsId: number) {
  const client = useClient()
  return useQuery({ queryKey: keys.board(wsId), queryFn: () => client.board(wsId) })
}

/**
 * Boards for several workspaces at once — the Control screen's triage view
 * spans every workspace. Shares cache keys with useBoard so per-workspace
 * screens reuse the same data.
 */
export function useBoards(workspaceIds: number[]) {
  const client = useClient()
  return useQueries({
    queries: workspaceIds.map((id) => ({
      queryKey: keys.board(id),
      queryFn: () => client.board(id),
    })),
  })
}

export function useTicket(id: number) {
  const client = useClient()
  return useQuery({ queryKey: keys.ticket(id), queryFn: () => client.ticket(id) })
}

export function useMemory(wsId: number) {
  const client = useClient()
  return useQuery({ queryKey: keys.memory(wsId), queryFn: () => client.memory(wsId) })
}

export function useGlobalMemory() {
  const client = useClient()
  return useQuery({ queryKey: keys.globalMemory, queryFn: () => client.globalMemory() })
}

export function useWorkspace(wsId: number) {
  const client = useClient()
  return useQuery({ queryKey: keys.workspace(wsId), queryFn: () => client.getWorkspace(wsId) })
}

export function useRun(runId: number) {
  const client = useClient()
  return useQuery({ queryKey: keys.run(runId), queryFn: () => client.run(runId) })
}

export function useActivity(workspaceId?: number) {
  const client = useClient()
  return useQuery({
    queryKey: keys.activity(workspaceId),
    queryFn: () => client.activity(workspaceId),
  })
}

export function useAdapters() {
  const client = useClient()
  return useQuery({ queryKey: keys.adapters, queryFn: () => client.adapters() })
}

export function useStatus() {
  const client = useClient()
  return useQuery({ queryKey: keys.status, queryFn: () => client.status() })
}

export function useKnownRepos() {
  const client = useClient()
  return useQuery({ queryKey: keys.knownRepos, queryFn: () => client.knownRepos() })
}

/** Debounces `name` before hitting GET /workspaces/check-name so a fast typist doesn't fire a
 * request per keystroke. */
export function useCheckName(name: string) {
  const client = useClient()
  const [debounced, setDebounced] = useState(name)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(name), CHECK_NAME_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [name])

  return useQuery({
    queryKey: keys.checkName(debounced),
    queryFn: () => client.checkName(debounced),
    enabled: debounced.trim().length > 0,
  })
}

export function useMoveTicket(wsId: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: number; to: { columnId: number; position: number } }) =>
      client.moveTicket(vars.id, vars.to),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: keys.board(wsId) })
      const previous = qc.getQueryData<ApiBoard>(keys.board(wsId))
      if (previous) {
        qc.setQueryData(keys.board(wsId), moveInBoard(previous, vars.id, vars.to))
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.board(wsId), context.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.board(wsId) })
      void qc.invalidateQueries({ queryKey: keys.workspaces })
    },
  })
}

export function useCreateTicket() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (t: { workspaceId: number; title: string; description?: string }) =>
      client.createTicket(t),
    onSuccess: (ticket) => {
      void qc.invalidateQueries({ queryKey: keys.board(ticket.workspaceId) })
    },
  })
}

export function useComment(ticketId: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => client.comment(ticketId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.ticket(ticketId) })
    },
  })
}

export function usePatchTicket(wsId: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      id: number
      patch: Partial<
        Pick<ApiTicket, 'title' | 'description' | 'position' | 'adapterOverride' | 'modelOverride'>
      >
    }) => client.patchTicket(vars.id, vars.patch),
    onMutate: async (vars) => {
      // Only position changes (reorders) get an optimistic board update;
      // other patches are edited in place on the detail screen.
      if (vars.patch.position === undefined) return {}
      await qc.cancelQueries({ queryKey: keys.board(wsId) })
      const previous = qc.getQueryData<ApiBoard>(keys.board(wsId))
      if (previous) {
        qc.setQueryData(keys.board(wsId), moveInBoard(previous, vars.id, { position: vars.patch.position }))
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.board(wsId), context.previous)
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: keys.ticket(vars.id) })
      void qc.invalidateQueries({ queryKey: keys.board(wsId) })
    },
  })
}

/** Shared onSuccess for the review-decision mutations (accept/send-back): the ticket leaves
 * in_review for a different column, so its own detail, its workspace's board, and the
 * workspaces list (queued/needs-review counts live there) all go stale together. */
function invalidateAfterReviewDecision(qc: ReturnType<typeof useQueryClient>, ticket: ApiTicket) {
  void qc.invalidateQueries({ queryKey: keys.ticket(ticket.id) })
  void qc.invalidateQueries({ queryKey: keys.board(ticket.workspaceId) })
  void qc.invalidateQueries({ queryKey: keys.workspaces })
}

export function useAccept() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ticketId: number) => client.accept(ticketId),
    onSuccess: (ticket) => invalidateAfterReviewDecision(qc, ticket),
  })
}

export function useSendBack() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { ticketId: number; feedback: string }) =>
      client.sendBack(vars.ticketId, vars.feedback),
    onSuccess: (ticket) => invalidateAfterReviewDecision(qc, ticket),
  })
}

export function useProposal() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { ticketId: number; action: 'keep' | 'dismiss' }) =>
      client.proposal(vars.ticketId, vars.action),
    onSuccess: (ticket, vars) => {
      void qc.invalidateQueries({ queryKey: keys.ticket(vars.ticketId) })
      if (ticket) void qc.invalidateQueries({ queryKey: keys.board(ticket.workspaceId) })
      void qc.invalidateQueries({ queryKey: keys.workspaces })
    },
  })
}

export function useNudge(runId: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (note: string) => client.nudge(runId, note),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.run(runId) })
    },
  })
}

export function useCreateWorkspace() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => client.createWorkspace(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspaces })
    },
  })
}

export function usePutMemory(wsId: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { file: string; body: string }) =>
      client.putMemory(wsId, vars.file, vars.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.memory(wsId) })
    },
  })
}

export function useGlobalPutMemory() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { file: string; body: string }) => client.putGlobalMemory(vars.file, vars.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.globalMemory })
    },
  })
}

export function useKeepNote(wsId?: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noteId: number) => client.keepNote(noteId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wsId !== undefined ? keys.memory(wsId) : keys.globalMemory })
    },
  })
}

export function useDiscardNote(wsId?: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noteId: number) => client.discardNote(noteId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wsId !== undefined ? keys.memory(wsId) : keys.globalMemory })
    },
  })
}

export function usePatchWorkspace(wsId: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      patch: Partial<
        Pick<ApiWorkspace, 'defaultAdapter' | 'defaultModel' | 'concurrency' | 'timeoutMs'>
      >,
    ) => client.patchWorkspace(wsId, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspace(wsId) })
      void qc.invalidateQueries({ queryKey: keys.workspaces })
    },
  })
}

export function useAddSource(wsId: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AddSourceBody) => client.addSource(wsId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspace(wsId) })
      void qc.invalidateQueries({ queryKey: keys.workspaces })
    },
  })
}

export function useRemoveSource(wsId: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => client.removeSource(wsId, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspace(wsId) })
      void qc.invalidateQueries({ queryKey: keys.workspaces })
    },
  })
}

/**
 * The workspace scoping every screen's Rail/BottomStrip/switcher operates in
 * — persisted on-device and defaulting to the first workspace once the list
 * loads. `activeWorkspaceId` is `undefined` while the stored id is still
 * loading and there's no workspace list yet to fall back to.
 */
export function useActiveWorkspace(): {
  activeWorkspaceId: number | undefined
  setActiveWorkspaceId: (id: number) => void
} {
  const { data: workspaces } = useWorkspaces()
  const [storedId, setStoredId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadActiveWorkspaceId().then((id) => {
      if (!cancelled) setStoredId(id)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const setActiveWorkspaceId = useCallback((id: number) => {
    setStoredId(id)
    void saveActiveWorkspaceId(id)
  }, [])

  const storedIsValid = storedId !== null && (workspaces ?? []).some((w) => w.id === storedId)
  const activeWorkspaceId = storedIsValid ? (storedId as number) : workspaces?.[0]?.id

  return { activeWorkspaceId, setActiveWorkspaceId }
}
