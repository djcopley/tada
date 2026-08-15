import { keys } from '../src/api/queries'
import { ApiError, TadaClient } from '../src/api/client'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function textResponse(status: number, body: string, contentType = 'application/x-ndjson'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    text: async () => body,
  } as unknown as Response
}

describe('TadaClient', () => {
  const conn = { baseUrl: 'https://api.example.com/', token: 'tok123' }

  test('listWorkspaces issues a GET with Authorization header and no body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, []))
    const client = new TadaClient(conn, fetchImpl)

    await client.listWorkspaces()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/workspaces')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok123')
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined()
    expect(init.body).toBeUndefined()
  })

  // Browsers enforce that `fetch` runs with `this === window` and throw "Illegal invocation"
  // otherwise. Holding it as an instance property and calling `this.fetchImpl(...)` rebinds `this`
  // to the client, which breaks every request on web (React Native's polyfill doesn't care, so
  // native builds hid this). jsdom doesn't enforce the WebIDL check, so assert the binding itself.
  test('fetch is not invoked as a method of the client', async () => {
    let capturedThis: unknown = 'never called'
    const fetchImpl = function (this: unknown): Promise<Response> {
      capturedThis = this
      return Promise.resolve(jsonResponse(200, []))
    }
    const client = new TadaClient(conn, fetchImpl as unknown as typeof fetch)

    await client.listWorkspaces()

    // `this` must be undefined or the global, never the client - both are legal receivers for the
    // browser's fetch, whereas the client is what triggers "Illegal invocation".
    expect(capturedThis).not.toBe(client)
    expect(capturedThis === undefined || capturedThis === globalThis).toBe(true)
  })

  test('moveTicket issues a POST with JSON content-type and body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    const client = new TadaClient(conn, fetchImpl)

    await client.moveTicket(42, { columnId: 3, position: 1.5 })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/tickets/42/move')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok123')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ columnId: 3, position: 1.5 }))
  })

  test('runEvents appends ?after= when provided', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, []))
    const client = new TadaClient(conn, fetchImpl)

    await client.runEvents(7)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/runs/7/events')

    await client.runEvents(7, 100)
    expect(fetchImpl.mock.calls[1][0]).toBe('https://api.example.com/runs/7/events?after=100')
  })

  test('throws ApiError with status and parsed body on non-2xx', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' }))
    const client = new TadaClient(conn, fetchImpl)

    await expect(client.listWorkspaces()).rejects.toMatchObject({
      status: 500,
      body: { error: 'boom' },
    })
    await expect(client.listWorkspaces()).rejects.toBeInstanceOf(ApiError)
  })

  test('transcript() returns raw text and throws ApiError with text body on failure', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(textResponse(200, '{"type":"text"}\n{"type":"tool_use"}\n'))
    const client = new TadaClient(conn, fetchImpl)

    const text = await client.transcript(9)
    expect(text).toBe('{"type":"text"}\n{"type":"tool_use"}\n')

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/runs/9/transcript')
    expect(init.method).toBe('GET')

    fetchImpl.mockResolvedValueOnce(textResponse(404, 'no transcript yet', 'text/plain'))
    await expect(client.transcript(9)).rejects.toMatchObject({
      status: 404,
      body: 'no transcript yet',
    })
  })

  test('wsUrl converts http(s) to ws(s) and embeds workspaceId + token', () => {
    const httpClient = new TadaClient({ baseUrl: 'http://localhost:4000', token: 'abc def' })
    expect(httpClient.wsUrl(5)).toBe('ws://localhost:4000/ws?workspaceId=5&token=abc%20def')

    const httpsClient = new TadaClient({ baseUrl: 'https://tada.example.com/', token: 't' })
    expect(httpsClient.wsUrl(9)).toBe('wss://tada.example.com/ws?workspaceId=9&token=t')
  })

  test('accept issues a POST with no body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { id: 1 }))
    const client = new TadaClient(conn, fetchImpl)

    await client.accept(42)

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/tickets/42/accept')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  test('sendBack issues a POST with the feedback body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { id: 1 }))
    const client = new TadaClient(conn, fetchImpl)

    await client.sendBack(42, 'ignored the filters')

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/tickets/42/send-back')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ feedback: 'ignored the filters' }))
  })

  test('proposal issues a POST with the action body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { id: 1 }))
    const client = new TadaClient(conn, fetchImpl)

    await client.proposal(42, 'keep')

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/tickets/42/proposal')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ action: 'keep' }))
  })

  test('nudge issues a POST with the note body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { delivered: true }))
    const client = new TadaClient(conn, fetchImpl)

    await client.nudge(7, 'try the other branch')

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/runs/7/nudge')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ note: 'try the other branch' }))
  })

  test('run issues a GET for the run detail', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { id: 7 }))
    const client = new TadaClient(conn, fetchImpl)

    await client.run(7)

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/runs/7')
    expect(init.method).toBe('GET')
  })

  test('activity omits the workspaceId query param when not given, and includes it (plus limit) when given', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, []))
    const client = new TadaClient(conn, fetchImpl)

    await client.activity()
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/activity')

    await client.activity('all')
    expect(fetchImpl.mock.calls[1][0]).toBe('https://api.example.com/activity')

    await client.activity(3, 10)
    expect(fetchImpl.mock.calls[2][0]).toBe('https://api.example.com/activity?workspaceId=3&limit=10')
  })

  test('adapters issues a GET', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, []))
    const client = new TadaClient(conn, fetchImpl)

    await client.adapters()

    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/adapters')
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe('GET')
  })

  test('status issues a GET', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    const client = new TadaClient(conn, fetchImpl)

    await client.status()

    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/status')
  })

  test('health issues a GET', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { ok: true, version: '1.0.0' }))
    const client = new TadaClient(conn, fetchImpl)

    await client.health()

    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/health')
  })

  test('globalMemory/putGlobalMemory/deleteGlobalMemory hit the top-level /memory routes', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { agentsMd: '', notes: [] }))
    const client = new TadaClient(conn, fetchImpl)

    await client.globalMemory()
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/memory')
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe('GET')

    await client.putGlobalMemory('conventions.md', 'be nice')
    const [putUrl, putInit] = fetchImpl.mock.calls[1] as [string, RequestInit]
    expect(putUrl).toBe('https://api.example.com/memory/conventions.md')
    expect(putInit.method).toBe('PUT')
    expect(putInit.body).toBe(JSON.stringify({ body: 'be nice' }))

    await client.deleteGlobalMemory('conventions.md')
    const [delUrl, delInit] = fetchImpl.mock.calls[2] as [string, RequestInit]
    expect(delUrl).toBe('https://api.example.com/memory/conventions.md')
    expect(delInit.method).toBe('DELETE')
  })

  test('keepNote/discardNote hit /memory-notes/:id/keep|discard', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(204, null))
    const client = new TadaClient(conn, fetchImpl)

    await client.keepNote(9)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/memory-notes/9/keep')
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe('POST')

    await client.discardNote(9)
    expect(fetchImpl.mock.calls[1][0]).toBe('https://api.example.com/memory-notes/9/discard')
    expect((fetchImpl.mock.calls[1][1] as RequestInit).method).toBe('POST')
  })

  test('addSource issues a POST with the discriminated source body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(201, []))
    const client = new TadaClient(conn, fetchImpl)

    await client.addSource(4, { type: 'repo', url: 'https://github.com/user/repo.git' })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/workspaces/4/sources')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ type: 'repo', url: 'https://github.com/user/repo.git' }))
  })

  test('removeSource issues a DELETE with the encoded source name', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, []))
    const client = new TadaClient(conn, fetchImpl)

    await client.removeSource(4, 'my repo')

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/workspaces/4/sources/my%20repo')
    expect(init.method).toBe('DELETE')
  })

  test('knownRepos issues a GET', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, []))
    const client = new TadaClient(conn, fetchImpl)

    await client.knownRepos()

    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/repos/known')
  })

  test('checkName issues a GET with the encoded name query param', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { id: 'my-name', available: true }))
    const client = new TadaClient(conn, fetchImpl)

    await client.checkName('my name')

    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/workspaces/check-name?name=my%20name')
  })

  test('getWorkspace issues a GET for the workspace detail (with sources)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { id: 4, sources: [] }))
    const client = new TadaClient(conn, fetchImpl)

    await client.getWorkspace(4)

    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/workspaces/4')
  })
})

describe('query key factory', () => {
  test('produces stable, distinct keys per entity', () => {
    expect(keys.workspaces).toEqual(['workspaces'])
    expect(keys.board(5)).toEqual(['board', 5])
    expect(keys.ticket(5)).toEqual(['ticket', 5])
    expect(keys.memory(5)).toEqual(['memory', 5])
    expect(keys.globalMemory).toEqual(['memory', 'global'])
    expect(keys.workspace(5)).toEqual(['workspace', 5])
    expect(keys.run(5)).toEqual(['run', 5])
    expect(keys.adapters).toEqual(['adapters'])
    expect(keys.status).toEqual(['status'])
    expect(keys.knownRepos).toEqual(['knownRepos'])
    expect(keys.checkName('parlor')).toEqual(['checkName', 'parlor'])
    expect(keys.board(5)).toEqual(keys.board(5))
    expect(keys.board(5)).not.toEqual(keys.ticket(5))
  })

  test('activity() is a prefix of activity(workspaceId), so a blunt invalidation of the bare key catches every scoped variant', () => {
    expect(keys.activity()).toEqual(['activity'])
    expect(keys.activity(3)).toEqual(['activity', 3])
  })
})
