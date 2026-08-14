import type {
  ApiBoard,
  ApiComment,
  ApiMemory,
  ApiRepo,
  ApiRun,
  ApiRunEvent,
  ApiTicket,
  ApiWorkspace,
  ApiWorkspaceListItem,
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

export class TadaClient {
  constructor(
    private conn: Connection,
    private fetchImpl: typeof fetch = fetch,
  ) {}

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

  health(): Promise<{ ok: boolean }> {
    return this.req('GET', '/health')
  }

  listWorkspaces(): Promise<ApiWorkspaceListItem[]> {
    return this.req('GET', '/workspaces')
  }

  createWorkspace(name: string): Promise<ApiWorkspace> {
    return this.req('POST', '/workspaces', { name })
  }

  getWorkspace(id: number): Promise<ApiWorkspace & { repos: ApiRepo[] }> {
    return this.req('GET', `/workspaces/${id}`)
  }

  patchWorkspace(
    id: number,
    patch: Partial<Pick<ApiWorkspace, 'defaultAdapter' | 'defaultModel' | 'concurrency' | 'timeoutMs'>>,
  ): Promise<ApiWorkspace> {
    return this.req('PATCH', `/workspaces/${id}`, patch)
  }

  async addRepo(wsId: number, url: string): Promise<void> {
    await this.req('POST', `/workspaces/${wsId}/repos`, { url })
  }

  async removeRepo(wsId: number, name: string): Promise<void> {
    await this.req('DELETE', `/workspaces/${wsId}/repos/${encodeURIComponent(name)}`)
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

  createTicket(t: { workspaceId: number; title: string; description?: string }): Promise<ApiTicket> {
    return this.req('POST', '/tickets', t)
  }

  async ticket(id: number): Promise<{ ticket: ApiTicket; comments: ApiComment[]; runs: ApiRun[] }> {
    const { comments, runs, ...ticket } = await this.req<
      ApiTicket & { comments: ApiComment[]; runs: ApiRun[] }
    >('GET', `/tickets/${id}`)
    return { ticket, comments, runs }
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

  comment(ticketId: number, body: string): Promise<ApiComment> {
    return this.req('POST', `/tickets/${ticketId}/comments`, { body })
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
