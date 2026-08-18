import type {
  ApiActivity,
  ApiAdapterInfo,
  ApiBoard,
  ApiComment,
  ApiHealth,
  ApiMemoryNote,
  ApiRule,
  ApiRunDetail,
  ApiRunDiff,
  ApiRunEvent,
  ApiSettings,
  ApiSource,
  ApiStatus,
  ApiTicket,
  ApiTicketDetail,
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

/** POST /sources body — a repo clone or a bare local folder. */
export type AddSourceBody = { type: 'repo'; url: string } | { type: 'folder'; path: string }

export type RuleBody = Pick<ApiRule, 'title' | 'description' | 'tool' | 'patterns' | 'decision' | 'publishes'>

export type SettingsPatch = Partial<ApiSettings>

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

  // --- system -------------------------------------------------------------------------------

  health(): Promise<ApiHealth> {
    return this.req('GET', '/health')
  }

  status(): Promise<ApiStatus> {
    return this.req('GET', '/status')
  }

  adapters(): Promise<ApiAdapterInfo[]> {
    return this.req('GET', '/adapters')
  }

  // --- settings, sources, rules ---------------------------------------------------------------

  settings(): Promise<ApiSettings> {
    return this.req('GET', '/settings')
  }

  patchSettings(patch: SettingsPatch): Promise<ApiSettings> {
    return this.req('PATCH', '/settings', patch)
  }

  sources(): Promise<ApiSource[]> {
    return this.req('GET', '/sources')
  }

  addSource(body: AddSourceBody): Promise<ApiSource[]> {
    return this.req('POST', '/sources', body)
  }

  removeSource(name: string): Promise<ApiSource[]> {
    return this.req('DELETE', `/sources/${encodeURIComponent(name)}`)
  }

  rules(): Promise<ApiRule[]> {
    return this.req('GET', '/rules')
  }

  createRule(body: Partial<RuleBody> & Pick<RuleBody, 'title' | 'decision'>): Promise<ApiRule> {
    return this.req('POST', '/rules', body)
  }

  patchRule(id: number, patch: Partial<RuleBody>): Promise<ApiRule> {
    return this.req('PATCH', `/rules/${id}`, patch)
  }

  async deleteRule(id: number): Promise<void> {
    await this.req('DELETE', `/rules/${id}`)
  }

  // --- board & tickets ------------------------------------------------------------------------

  board(): Promise<ApiBoard> {
    return this.req('GET', '/board')
  }

  createTicket(t: {
    title: string
    description?: string
    column?: 'backlog' | 'queued'
    repoTags?: string[]
  }): Promise<ApiTicket> {
    return this.req('POST', '/tickets', t)
  }

  ticket(id: number): Promise<ApiTicketDetail> {
    return this.req('GET', `/tickets/${id}`)
  }

  patchTicket(id: number, patch: Partial<Pick<ApiTicket, 'title' | 'description'>>): Promise<ApiTicket> {
    return this.req('PATCH', `/tickets/${id}`, patch)
  }

  moveTicket(id: number, to: { column: 'backlog' | 'queued' | 'done'; position?: number }): Promise<ApiTicket> {
    return this.req('POST', `/tickets/${id}/move`, to)
  }

  rerun(id: number): Promise<ApiTicket> {
    return this.req('POST', `/tickets/${id}/rerun`)
  }

  duplicateTicket(id: number): Promise<ApiTicket> {
    return this.req('POST', `/tickets/${id}/duplicate`)
  }

  async deleteTicket(id: number): Promise<void> {
    await this.req('DELETE', `/tickets/${id}`)
  }

  proposal(ticketId: number, action: 'keep' | 'dismiss'): Promise<ApiTicket | undefined> {
    return this.req('POST', `/tickets/${ticketId}/proposal`, { action })
  }

  /** A note to the agent — injected live when the run is going, read at start otherwise. */
  note(ticketId: number, body: string): Promise<{ comment: ApiComment; delivered: boolean }> {
    return this.req('POST', `/tickets/${ticketId}/notes`, { body })
  }

  // --- runs ---------------------------------------------------------------------------------

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

  /** Only answers while the run is held at a publish gate; 409 otherwise. */
  runDiff(runId: number): Promise<ApiRunDiff> {
    return this.req('GET', `/runs/${runId}/diff`)
  }

  async cancelRun(runId: number): Promise<void> {
    await this.req('POST', `/runs/${runId}/cancel`)
  }

  async approve(runId: number, opts: { alwaysAllow?: boolean } = {}): Promise<void> {
    await this.req('POST', `/runs/${runId}/approve`, { alwaysAllow: opts.alwaysAllow ?? false })
  }

  async deny(runId: number, note: string, opts: { saveToMemory?: boolean } = {}): Promise<void> {
    await this.req('POST', `/runs/${runId}/deny`, { note, saveToMemory: opts.saveToMemory ?? false })
  }

  async answer(runId: number, answer: string, opts: { saveToMemory?: boolean } = {}): Promise<void> {
    await this.req('POST', `/runs/${runId}/answer`, { answer, saveToMemory: opts.saveToMemory ?? false })
  }

  async continueRun(runId: number, extraMs?: number): Promise<void> {
    await this.req('POST', `/runs/${runId}/continue`, extraMs === undefined ? {} : { extraMs })
  }

  // --- memory -------------------------------------------------------------------------------

  memory(): Promise<ApiMemoryNote[]> {
    return this.req('GET', '/memory')
  }

  createNote(note: { title: string; body: string; tags?: string[] }): Promise<ApiMemoryNote> {
    return this.req('POST', '/memory', note)
  }

  patchNote(id: number, patch: Partial<Pick<ApiMemoryNote, 'title' | 'body' | 'tags'>>): Promise<ApiMemoryNote> {
    return this.req('PATCH', `/memory/${id}`, patch)
  }

  async deleteNote(id: number): Promise<void> {
    await this.req('DELETE', `/memory/${id}`)
  }

  async keepNote(id: number): Promise<void> {
    await this.req('POST', `/memory/${id}/keep`)
  }

  async dismissNote(id: number): Promise<void> {
    await this.req('POST', `/memory/${id}/dismiss`)
  }

  // --- activity, push, ws ---------------------------------------------------------------------

  activity(limit?: number): Promise<ApiActivity[]> {
    return this.req('GET', `/activity${limit !== undefined ? `?limit=${limit}` : ''}`)
  }

  async registerPushToken(token: string): Promise<void> {
    await this.req('POST', '/push-tokens', { token })
  }

  webPushPublicKey(): Promise<{ publicKey: string }> {
    return this.req('GET', '/web-push/public-key')
  }

  async registerWebPushSubscription(sub: {
    endpoint: string
    keys: { p256dh: string; auth: string }
  }): Promise<void> {
    await this.req('POST', '/web-push/subscriptions', sub)
  }

  async sendTestPing(): Promise<void> {
    await this.req('POST', '/web-push/test', {})
  }

  wsUrl(): string {
    const wsBase = this.baseUrl()
      .replace(/^https:/, 'wss:')
      .replace(/^http:/, 'ws:')
    return `${wsBase}/ws?token=${encodeURIComponent(this.conn.token)}`
  }
}
