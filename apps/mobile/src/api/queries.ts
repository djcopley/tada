import type { ApiBoard, ApiMemoryNote, ApiTicket, ColumnKind } from '@tada/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AddSourceBody, RuleBody, SettingsPatch } from './client'
import { useClient } from './ClientContext'

/**
 * Applies a move/reorder to a cached board snapshot so the card lands instantly; the server
 * round-trip then reconciles via invalidation.
 */
export function moveInBoard(
  board: ApiBoard,
  ticketId: number,
  to: { column?: ColumnKind; position?: number },
): ApiBoard {
  let moved: ApiTicket | undefined
  const next = { ...board }
  for (const key of Object.keys(board) as ColumnKind[]) {
    const found = board[key].find((t) => t.id === ticketId)
    if (found) {
      moved = found
      next[key] = board[key].filter((t) => t.id !== ticketId)
    }
  }
  if (!moved) return board
  const target = to.column ?? moved.column
  const placed: ApiTicket = { ...moved, column: target, position: to.position ?? moved.position }
  next[target] = [...next[target], placed].sort((a, b) => a.position - b.position)
  return next
}

export const keys = {
  board: ['board'] as const,
  ticket: (id: number) => ['ticket', id] as const,
  memory: ['memory'] as const,
  run: (id: number) => ['run', id] as const,
  runDiff: (id: number) => ['runDiff', id] as const,
  activity: ['activity'] as const,
  adapters: ['adapters'] as const,
  status: ['status'] as const,
  settings: ['settings'] as const,
  sources: ['sources'] as const,
  rules: ['rules'] as const,
}

export function useBoard() {
  const client = useClient()
  return useQuery({ queryKey: keys.board, queryFn: () => client.board() })
}

export function useTicket(id: number) {
  const client = useClient()
  return useQuery({ queryKey: keys.ticket(id), queryFn: () => client.ticket(id), enabled: Number.isFinite(id) })
}

export function useMemory() {
  const client = useClient()
  return useQuery({ queryKey: keys.memory, queryFn: () => client.memory() })
}

export function useRun(runId: number) {
  const client = useClient()
  return useQuery({ queryKey: keys.run(runId), queryFn: () => client.run(runId), enabled: Number.isFinite(runId) })
}

/** The diff at a publish gate. Disabled unless the caller says the run is at one — the server
 * 409s otherwise, and there is no reason to ask. */
export function useRunDiff(runId: number, enabled: boolean) {
  const client = useClient()
  return useQuery({ queryKey: keys.runDiff(runId), queryFn: () => client.runDiff(runId), enabled: enabled && Number.isFinite(runId) })
}

export function useActivity(limit?: number) {
  const client = useClient()
  return useQuery({ queryKey: [...keys.activity, limit ?? 'default'], queryFn: () => client.activity(limit) })
}

export function useAdapters() {
  const client = useClient()
  return useQuery({ queryKey: keys.adapters, queryFn: () => client.adapters() })
}

export function useStatus() {
  const client = useClient()
  return useQuery({ queryKey: keys.status, queryFn: () => client.status() })
}

export function useSettings() {
  const client = useClient()
  return useQuery({ queryKey: keys.settings, queryFn: () => client.settings() })
}

export function useSources() {
  const client = useClient()
  return useQuery({ queryKey: keys.sources, queryFn: () => client.sources() })
}

export function useRules() {
  const client = useClient()
  return useQuery({ queryKey: keys.rules, queryFn: () => client.rules() })
}

// --- mutations ----------------------------------------------------------------------------------

function invalidateTicket(qc: ReturnType<typeof useQueryClient>, ticketId?: number) {
  void qc.invalidateQueries({ queryKey: keys.board })
  if (ticketId !== undefined) void qc.invalidateQueries({ queryKey: keys.ticket(ticketId) })
  void qc.invalidateQueries({ queryKey: keys.activity })
}

export function useMoveTicket() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: number; to: { column: 'backlog' | 'queued' | 'done'; position?: number } }) =>
      client.moveTicket(vars.id, vars.to),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: keys.board })
      const previous = qc.getQueryData<ApiBoard>(keys.board)
      if (previous) qc.setQueryData(keys.board, moveInBoard(previous, vars.id, vars.to))
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.board, context.previous)
    },
    onSettled: (_data, _err, vars) => invalidateTicket(qc, vars.id),
  })
}

export function useCreateTicket() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (t: {
      title: string
      description?: string
      column?: 'backlog' | 'queued'
      repoTags?: string[]
    }) => client.createTicket(t),
    onSuccess: () => invalidateTicket(qc),
  })
}

export function usePatchTicket() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: number; patch: Partial<Pick<ApiTicket, 'title' | 'description'>> }) =>
      client.patchTicket(vars.id, vars.patch),
    onSuccess: (_t, vars) => invalidateTicket(qc, vars.id),
  })
}

export function useRerun() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => client.rerun(id), onSuccess: (_t, id) => invalidateTicket(qc, id) })
}

export function useDuplicateTicket() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => client.duplicateTicket(id), onSuccess: () => invalidateTicket(qc) })
}

export function useDeleteTicket() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => client.deleteTicket(id),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: keys.ticket(id) })
      invalidateTicket(qc)
    },
  })
}

export function useProposal() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { ticketId: number; action: 'keep' | 'dismiss' }) => client.proposal(vars.ticketId, vars.action),
    onSuccess: (ticket, vars) => {
      if (!ticket) qc.removeQueries({ queryKey: keys.ticket(vars.ticketId) })
      invalidateTicket(qc, ticket ? vars.ticketId : undefined)
    },
  })
}

/** Send a note to the agent. Resolves with whether it was delivered to a live session. */
export function useNote(ticketId: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => client.note(ticketId, body),
    onSuccess: () => invalidateTicket(qc, ticketId),
  })
}

function invalidateRun(qc: ReturnType<typeof useQueryClient>, runId: number) {
  void qc.invalidateQueries({ queryKey: keys.run(runId) })
  void qc.invalidateQueries({ queryKey: keys.board })
  void qc.invalidateQueries({ queryKey: ['ticket'] })
  void qc.invalidateQueries({ queryKey: keys.activity })
}

export function useCancelRun() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (runId: number) => client.cancelRun(runId), onSuccess: (_v, runId) => invalidateRun(qc, runId) })
}

/** Approve the held call. `alwaysAllow` edits the rule table too (and Settings' list refreshes). */
export function useApprove() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { runId: number; alwaysAllow?: boolean }) => client.approve(vars.runId, { alwaysAllow: vars.alwaysAllow }),
    onSuccess: (_v, vars) => {
      invalidateRun(qc, vars.runId)
      if (vars.alwaysAllow) void qc.invalidateQueries({ queryKey: keys.rules })
    },
  })
}

export function useDeny() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { runId: number; note: string; saveToMemory?: boolean }) =>
      client.deny(vars.runId, vars.note, { saveToMemory: vars.saveToMemory }),
    onSuccess: (_v, vars) => {
      invalidateRun(qc, vars.runId)
      if (vars.saveToMemory) void qc.invalidateQueries({ queryKey: keys.memory })
    },
  })
}

export function useAnswer() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { runId: number; answer: string; saveToMemory?: boolean }) =>
      client.answer(vars.runId, vars.answer, { saveToMemory: vars.saveToMemory }),
    onSuccess: (_v, vars) => {
      invalidateRun(qc, vars.runId)
      if (vars.saveToMemory) void qc.invalidateQueries({ queryKey: keys.memory })
    },
  })
}

export function useContinueRun() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { runId: number; extraMs?: number }) => client.continueRun(vars.runId, vars.extraMs),
    onSuccess: (_v, vars) => invalidateRun(qc, vars.runId),
  })
}

// memory
function invalidateMemory(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: keys.memory })
  void qc.invalidateQueries({ queryKey: keys.activity })
}

export function useCreateNote() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (note: { title: string; body: string; tags?: string[] }) => client.createNote(note),
    onSuccess: () => invalidateMemory(qc),
  })
}

export function usePatchNote() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: number; patch: Partial<Pick<ApiMemoryNote, 'title' | 'body' | 'tags'>> }) =>
      client.patchNote(vars.id, vars.patch),
    onSuccess: () => invalidateMemory(qc),
  })
}

export function useDeleteNote() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => client.deleteNote(id), onSuccess: () => invalidateMemory(qc) })
}

export function useKeepNote() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => client.keepNote(id), onSuccess: () => invalidateMemory(qc) })
}

export function useDismissNote() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => client.dismissNote(id), onSuccess: () => invalidateMemory(qc) })
}

// settings, sources, rules
export function usePatchSettings() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) => client.patchSettings(patch),
    onSuccess: (data) => qc.setQueryData(keys.settings, data),
  })
}

export function useAddSource() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AddSourceBody) => client.addSource(body),
    onSuccess: (data) => {
      qc.setQueryData(keys.sources, data)
      void qc.invalidateQueries({ queryKey: keys.status })
    },
  })
}

export function useRemoveSource() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => client.removeSource(name),
    onSuccess: (data) => {
      qc.setQueryData(keys.sources, data)
      void qc.invalidateQueries({ queryKey: keys.status })
    },
  })
}

export function useCreateRule() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<RuleBody> & Pick<RuleBody, 'title' | 'decision'>) => client.createRule(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.rules }),
  })
}

export function usePatchRule() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: number; patch: Partial<RuleBody> }) => client.patchRule(vars.id, vars.patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.rules }),
  })
}

export function useDeleteRule() {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => client.deleteRule(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.rules }),
  })
}
