import type { ApiBoard, ApiTicket, ApiWorkspace } from '@tada/shared'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
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
  return useQuery({ queryKey: keys.board(wsId), queryFn: () => client.board(wsId), enabled: Number.isFinite(wsId) })
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
  return useQuery({ queryKey: keys.ticket(id), queryFn: () => client.ticket(id), enabled: Number.isFinite(id) })
}

/**
 * Ticket detail (comments + runs) for several tickets at once — the Control screen's
 * triage cards need each needs-you/live ticket's latest run and agent comment, which
 * the bare board DTO doesn't carry. Shares cache keys with useTicket.
 */
export function useTicketDetails(ticketIds: number[]) {
  const client = useClient()
  return useQueries({
    queries: ticketIds.map((id) => ({
      queryKey: keys.ticket(id),
      queryFn: () => client.ticket(id),
    })),
  })
}

/** `wsId` may be `undefined` (e.g. the Control screen before an active workspace has loaded) —
 * in that case the query simply stays disabled rather than fetching a bogus id. */
export function useMemory(wsId: number | undefined) {
  const client = useClient()
  return useQuery({
    queryKey: keys.memory(wsId ?? -1),
    queryFn: () => client.memory(wsId as number),
    enabled: wsId !== undefined && Number.isFinite(wsId),
  })
}

export function useGlobalMemory() {
  const client = useClient()
  return useQuery({ queryKey: keys.globalMemory, queryFn: () => client.globalMemory() })
}

/** `wsId` may be `undefined` (e.g. the run screen before `useRun` has resolved a `workspaceId`
 * to fetch) — in that case the query simply stays disabled rather than fetching a bogus id. */
export function useWorkspace(wsId: number | undefined) {
  const client = useClient()
  return useQuery({
    queryKey: keys.workspace(wsId ?? -1),
    queryFn: () => client.getWorkspace(wsId as number),
    enabled: wsId !== undefined && Number.isFinite(wsId),
  })
}

export function useRun(runId: number) {
  const client = useClient()
  return useQuery({ queryKey: keys.run(runId), queryFn: () => client.run(runId), enabled: Number.isFinite(runId) })
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
      if (ticket) {
        void qc.invalidateQueries({ queryKey: keys.ticket(vars.ticketId) })
      } else {
        // Dismissed: the ticket is gone, so drop it rather than refetch a 404.
        qc.removeQueries({ queryKey: keys.ticket(vars.ticketId) })
      }
      // Dismiss returns no body, so refresh every board rather than only the kept ticket's.
      void qc.invalidateQueries({ queryKey: ['board'] })
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
      // The nudge lands in the ticket thread as a comment too.
      void qc.invalidateQueries({ queryKey: ['ticket'] })
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

/** Deletes a note file (never AGENTS.md); `wsId` undefined = the global scope. */
export function useDeleteMemory(wsId?: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: string) => (wsId !== undefined ? client.deleteMemory(wsId, file) : client.deleteGlobalMemory(file)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wsId !== undefined ? keys.memory(wsId) : keys.globalMemory })
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
        Pick<ApiWorkspace, 'defaultAdapter' | 'defaultModel' | 'defaultEffort' | 'concurrency' | 'timeoutMs'>
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
// One shared value for every mounted screen (Control, Board, Memory, Settings all stay mounted
// as tabs), rather than per-hook-instance state: a Board picking its workspace has to be seen
// by Control's strip immediately, not on Control's next mount.
let activeIdValue: number | null = null
let activeIdLoaded = false
const activeIdListeners = new Set<() => void>()
function readActiveId(): number | null {
  return activeIdValue
}
function writeActiveId(id: number | null): void {
  activeIdValue = id
  for (const l of activeIdListeners) l()
}
function subscribeActiveId(l: () => void): () => void {
  activeIdListeners.add(l)
  if (!activeIdLoaded) {
    activeIdLoaded = true
    void loadActiveWorkspaceId().then((id) => {
      if (activeIdValue === null) writeActiveId(id)
    })
  }
  return () => {
    activeIdListeners.delete(l)
  }
}
/** Test hook: forget the shared active-workspace value between cases. */
export function resetActiveWorkspaceForTests(): void {
  activeIdValue = null
  activeIdLoaded = false
}

export function useActiveWorkspace(): {
  activeWorkspaceId: number | undefined
  setActiveWorkspaceId: (id: number) => void
} {
  const { data: workspaces } = useWorkspaces()
  const storedId = useSyncExternalStore(subscribeActiveId, readActiveId, readActiveId)

  const setActiveWorkspaceId = useCallback((id: number) => {
    if (id === activeIdValue) return
    writeActiveId(id)
    void saveActiveWorkspaceId(id)
  }, [])

  const storedIsValid = storedId !== null && (workspaces ?? []).some((w) => w.id === storedId)
  const activeWorkspaceId = storedIsValid ? (storedId as number) : workspaces?.[0]?.id

  return { activeWorkspaceId, setActiveWorkspaceId }
}
