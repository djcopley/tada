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
})

describe('query key factory', () => {
  test('produces stable, distinct keys per entity', () => {
    expect(keys.workspaces).toEqual(['workspaces'])
    expect(keys.board(5)).toEqual(['board', 5])
    expect(keys.ticket(5)).toEqual(['ticket', 5])
    expect(keys.memory(5)).toEqual(['memory', 5])
    expect(keys.workspace(5)).toEqual(['workspace', 5])
    expect(keys.board(5)).toEqual(keys.board(5))
    expect(keys.board(5)).not.toEqual(keys.ticket(5))
  })
})
