import type { ApiTicket, ApiWorkspace } from '@tada/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useClient } from './ClientContext'

export const keys = {
  workspaces: ['workspaces'] as const,
  board: (id: number) => ['board', id] as const,
  ticket: (id: number) => ['ticket', id] as const,
  memory: (id: number) => ['memory', id] as const,
  workspace: (id: number) => ['workspace', id] as const,
}

export function useWorkspaces() {
  const client = useClient()
  return useQuery({ queryKey: keys.workspaces, queryFn: () => client.listWorkspaces() })
}

export function useBoard(wsId: number) {
  const client = useClient()
  return useQuery({ queryKey: keys.board(wsId), queryFn: () => client.board(wsId) })
}

export function useTicket(id: number) {
  const client = useClient()
  return useQuery({ queryKey: keys.ticket(id), queryFn: () => client.ticket(id) })
}

export function useMemory(wsId: number) {
  const client = useClient()
  return useQuery({ queryKey: keys.memory(wsId), queryFn: () => client.memory(wsId) })
}

export function useWorkspace(wsId: number) {
  const client = useClient()
  return useQuery({ queryKey: keys.workspace(wsId), queryFn: () => client.getWorkspace(wsId) })
}

export function useMoveTicket(wsId: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: number; to: { columnId: number; position: number } }) =>
      client.moveTicket(vars.id, vars.to),
    onSuccess: () => {
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
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: keys.ticket(vars.id) })
      void qc.invalidateQueries({ queryKey: keys.board(wsId) })
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

export function useAddRepo(wsId: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (url: string) => client.addRepo(wsId, url),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspace(wsId) })
      void qc.invalidateQueries({ queryKey: keys.workspaces })
    },
  })
}

export function useRemoveRepo(wsId: number) {
  const client = useClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => client.removeRepo(wsId, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspace(wsId) })
      void qc.invalidateQueries({ queryKey: keys.workspaces })
    },
  })
}
