import type {
  ApiActivity,
  ApiAdapterInfo,
  ApiBoard,
  ApiComment,
  ApiHealth,
  ApiKnownRepo,
  ApiMemory,
  ApiNameCheck,
  ApiRun,
  ApiRunDetail,
  ApiRunEvent,
  ApiSource,
  ApiStatus,
  ApiTicket,
  ApiTicketDetail,
  ApiWorkspace,
  ApiWorkspaceDetail,
  ApiWorkspaceListItem,
  ProposalState,
} from '@tada/shared'
import type { Connection } from '../settings'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API error ${status}`)
    this.name = 'ApiError'
  }
}

/** POST /workspaces/:id/sources body — a repo clone or a bare local folder. */
export type AddSourceBody = { type: 'repo'; url: string } | { type: 'folder'; path: string }

export class TadaClient {
  private readonly fetchImpl: typeof fetch

  constructor(
    private conn: Connection,
    fetchImpl: typeof fetch = fetch,
  ) {
    // Wrapped rather than stored directly: browsers require `fetch` to run with `this === window`,
    // so calling a bare `this.fetchImpl(...)` would rebind `this` to this client and throw
    // "Illegal invocation" on web. The arrow keeps the call site a plain, unbound invocation.
    this.fetchImpl = (input, init) => fetchImpl(input, init)
  }

  private baseUrl(): string {
    return this.conn.baseUrl.replace(/\/+$/, '')
  }

  private headers(hasBody: boolean): HeadersInit {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.conn.token}` }
    if (hasBody) headers['content-type'] = 'application/json'
    return headers
  }

  private async parseJsonBody(res: Response): Promise<unknown> {
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return undefined
    const text = await res.text()
    if (text.length === 0) return undefined
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl()}${path}`, {
      method,
      headers: this.headers(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const parsed = await this.parseJsonBody(res)
    if (!res.ok) throw new ApiError(res.status, parsed)
    return parsed as T
  }

  health(): Promise<ApiHealth> {
    return this.req('GET', '/health')
  }

  status(): Promise<ApiStatus> {
    return this.req('GET', '/status')
  }

  adapters(): Promise<ApiAdapterInfo[]> {
    return this.req('GET', '/adapters')
  }

  listWorkspaces(): Promise<ApiWorkspaceListItem[]> {
    return this.req('GET', '/workspaces')
  }

  createWorkspace(name: string): Promise<ApiWorkspace> {
    return this.req('POST', '/workspaces', { name })
  }

  getWorkspace(id: number): Promise<ApiWorkspaceDetail> {
    return this.req('GET', `/workspaces/${id}`)
  }

  checkName(name: string): Promise<ApiNameCheck> {
    return this.req('GET', `/workspaces/check-name?name=${encodeURIComponent(name)}`)
  }

  knownRepos(): Promise<ApiKnownRepo[]> {
    return this.req('GET', '/repos/known')
  }

  patchWorkspace(
    id: number,
    patch: Partial<Pick<ApiWorkspace, 'defaultAdapter' | 'defaultModel' | 'concurrency' | 'timeoutMs'>>,
  ): Promise<ApiWorkspace> {
    return this.req('PATCH', `/workspaces/${id}`, patch)
  }

  addSource(wsId: number, body: AddSourceBody): Promise<ApiSource[]> {
    return this.req('POST', `/workspaces/${wsId}/sources`, body)
  }

  removeSource(wsId: number, name: string): Promise<ApiSource[]> {
    return this.req('DELETE', `/workspaces/${wsId}/sources/${encodeURIComponent(name)}`)
  }

  board(wsId: number): Promise<ApiBoard> {
    return this.req('GET', `/workspaces/${wsId}/board`)
  }

  memory(wsId: number): Promise<ApiMemory> {
    return this.req('GET', `/workspaces/${wsId}/memory`)
  }

  async putMemory(wsId: number, file: string, body: string): Promise<void> {
    await this.req('PUT', `/workspaces/${wsId}/memory/${encodeURIComponent(file)}`, { body })
  }

  async deleteMemory(wsId: number, file: string): Promise<void> {
    await this.req('DELETE', `/workspaces/${wsId}/memory/${encodeURIComponent(file)}`)
  }

  globalMemory(): Promise<ApiMemory> {
    return this.req('GET', '/memory')
  }

  async putGlobalMemory(file: string, body: string): Promise<void> {
    await this.req('PUT', `/memory/${encodeURIComponent(file)}`, { body })
  }

  async deleteGlobalMemory(file: string): Promise<void> {
    await this.req('DELETE', `/memory/${encodeURIComponent(file)}`)
  }

  async keepNote(id: number): Promise<void> {
    await this.req('POST', `/memory-notes/${id}/keep`)
  }

  async discardNote(id: number): Promise<void> {
    await this.req('POST', `/memory-notes/${id}/discard`)
  }

  createTicket(t: { workspaceId: number; title: string; description?: string }): Promise<ApiTicket> {
    return this.req('POST', '/tickets', t)
  }

  async ticket(id: number): Promise<{
    ticket: ApiTicket
    comments: ApiComment[]
    runs: ApiRun[]
    followUps: ApiTicketDetail['followUps']
  }> {
    const { comments, runs, followUps, ...ticket } = await this.req<
      ApiTicket & { comments: ApiComment[]; runs: ApiRun[]; followUps: ApiTicketDetail['followUps'] }
    >('GET', `/tickets/${id}`)
    return { ticket, comments, runs, followUps }
  }

  patchTicket(
    id: number,
    patch: Partial<Pick<ApiTicket, 'title' | 'description' | 'position' | 'adapterOverride' | 'modelOverride'>>,
  ): Promise<ApiTicket> {
    return this.req('PATCH', `/tickets/${id}`, patch)
  }

  async moveTicket(id: number, to: { columnId: number; position: number }): Promise<void> {
    await this.req('POST', `/tickets/${id}/move`, to)
  }

  accept(ticketId: number): Promise<ApiTicket> {
    return this.req('POST', `/tickets/${ticketId}/accept`)
  }

  sendBack(ticketId: number, feedback: string): Promise<ApiTicket> {
    return this.req('POST', `/tickets/${ticketId}/send-back`, { feedback })
  }

  proposal(ticketId: number, action: Exclude<ProposalState, null> | 'keep' | 'dismiss'): Promise<ApiTicket | undefined> {
    return this.req('POST', `/tickets/${ticketId}/proposal`, { action })
  }

  comment(ticketId: number, body: string): Promise<ApiComment> {
    return this.req('POST', `/tickets/${ticketId}/comments`, { body })
  }

  run(runId: number): Promise<ApiRunDetail> {
    return this.req('GET', `/runs/${runId}`)
  }

  runEvents(runId: number, after?: number): Promise<ApiRunEvent[]> {
    const query = after !== undefined ? `?after=${after}` : ''
    return this.req('GET', `/runs/${runId}/events${query}`)
  }

  async transcript(runId: number): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl()}/runs/${runId}/transcript`, {
      method: 'GET',
      headers: this.headers(false),
    })
    const text = await res.text()
    if (!res.ok) throw new ApiError(res.status, text)
    return text
  }

  async cancelRun(runId: number): Promise<void> {
    await this.req('POST', `/runs/${runId}/cancel`)
  }

  nudge(runId: number, note: string): Promise<{ delivered: boolean }> {
    return this.req('POST', `/runs/${runId}/nudge`, { note })
  }

  activity(workspaceId?: number | 'all', limit?: number): Promise<ApiActivity[]> {
    const params = new URLSearchParams()
    if (typeof workspaceId === 'number') params.set('workspaceId', String(workspaceId))
    if (limit !== undefined) params.set('limit', String(limit))
    const query = params.toString()
    return this.req('GET', `/activity${query ? `?${query}` : ''}`)
  }

  async registerPushToken(token: string): Promise<void> {
    await this.req('POST', '/push-tokens', { token })
  }

  wsUrl(workspaceId: number): string {
    const wsBase = this.baseUrl()
      .replace(/^https:/, 'wss:')
      .replace(/^http:/, 'ws:')
    return `${wsBase}/ws?workspaceId=${workspaceId}&token=${encodeURIComponent(this.conn.token)}`
  }
}
