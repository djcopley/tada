import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, test } from 'vitest'
import { activity, comments, memoryNotes, tickets } from '../src/db/schema.js'
import { pendingOutcome } from '../src/mcp/server.js'
import { storeAnswer } from '../src/runs/answers.js'
import { runDirPath } from '../src/runs/runDir.js'
import { makeOrigin } from './helpers/gitFixtures.js'
import { makeTestApp, seedRun, seedTicket, type TestApp } from './helpers/testApp.js'

let t: TestApp
let client: Client

async function connect(status: 'running' | 'held' | 'done' = 'running') {
  t = await makeTestApp()
  const ticket = seedTicket(t.db, { column: 'running' })
  const run = seedRun(t.db, ticket.id, { status })
  const address = await t.app.listen({ port: 0, host: '127.0.0.1' })
  const transport = new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${run.runToken}` } },
  })
  client = new Client({ name: 'test', version: '0' })
  await client.connect(transport)
  return { ticket, run }
}

const text = (r: Awaited<ReturnType<Client['callTool']>>) =>
  (r.content as { type: string; text: string }[]).map((c) => c.text).join('\n')

afterEach(async () => {
  await client?.close()
  await t?.app.close()
})

describe('MCP', () => {
  test('rejects a bad token, accepts a held run', async () => {
    const { run } = await connect('held')
    const tools = await client?.listTools()
    expect(tools?.tools.map((x) => x.name).sort()).toEqual([
      'ask_user',
      'attach_file',
      'attach_link',
      'propose_ticket',
      'report_outcome',
      'update_ticket',
      'use_repo',
      'write_memory_note',
    ])
    const res = await t.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: 'Bearer nope', 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    expect(res.statusCode).toBe(401)
    void run
  })

  test('use_repo makes the worktree lazily, stamps the tag, and hands over repo-tagged notes', async () => {
    const { ticket, run } = await connect()
    await t.store.addRepo(await makeOrigin('proj'))
    t.db.drizzle
      .insert(memoryNotes)
      .values([
        {
          title: 'Testing',
          body: 'pnpm test first',
          tags: ['proj'],
          author: 'human',
          state: 'kept',
        },
        { title: 'Global', body: 'not for use_repo', tags: [], author: 'human', state: 'kept' },
        {
          title: 'Pending',
          body: 'not yet kept',
          tags: ['proj'],
          author: 'agent',
          state: 'pending',
        },
      ])
      .run()
    expect(
      t.db.drizzle.select().from(tickets).where(eq(tickets.id, ticket.id)).get()?.repoTags,
    ).toEqual([])

    const bad = await client.callTool({ name: 'use_repo', arguments: { name: 'nope' } })
    expect(bad.isError).toBe(true)
    expect(text(bad)).toContain('connected repos: proj')

    const ok = await client.callTool({ name: 'use_repo', arguments: { name: 'proj' } })
    const wt = join(runDirPath(run.id), 'proj')
    expect(text(ok)).toContain(`worktree ready at ${wt}`)
    expect(text(ok)).toContain('pnpm test first')
    expect(text(ok)).not.toContain('not for use_repo')
    expect(text(ok)).not.toContain('not yet kept')
    expect(existsSync(join(wt, 'README.md'))).toBe(true)
    expect(
      t.db.drizzle.select().from(tickets).where(eq(tickets.id, ticket.id)).get()?.repoTags,
    ).toEqual(['proj'])

    // idempotent
    const again = await client.callTool({ name: 'use_repo', arguments: { name: 'proj' } })
    expect(text(again)).toContain('worktree ready')
    expect(
      t.db.drizzle.select().from(tickets).where(eq(tickets.id, ticket.id)).get()?.repoTags,
    ).toEqual(['proj'])
  })

  test('ask_user returns the answer the gate stored', async () => {
    const { run } = await connect()
    const none = await client.callTool({ name: 'ask_user', arguments: { question: 'q?' } })
    expect(none.isError).toBe(true)
    // via updatedInput
    const viaInput = await client.callTool({
      name: 'ask_user',
      arguments: { question: 'q?', answer: '30s' },
    })
    expect(text(viaInput)).toBe('The human answered: 30s')
    // via the fallback registry
    storeAnswer(run.id, '5m')
    const viaStore = await client.callTool({ name: 'ask_user', arguments: { question: 'q?' } })
    expect(text(viaStore)).toBe('The human answered: 5m')
  })

  test('update_ticket, attach_link, attach_file post to the thread', async () => {
    const { ticket, run } = await connect()
    await client.callTool({ name: 'update_ticket', arguments: { comment: 'progress' } })
    await client.callTool({ name: 'attach_link', arguments: { url: 'https://x', label: 'x' } })
    const src = join(mkdtempSync(join(tmpdir(), 'tada-att-')), 'a.txt')
    writeFileSync(src, 'hi')
    const att = await client.callTool({ name: 'attach_file', arguments: { path: src } })
    expect(existsSync(text(att))).toBe(true)
    const thread = t.db.drizzle
      .select()
      .from(comments)
      .where(eq(comments.ticketId, ticket.id))
      .all()
    expect(thread.map((c) => [c.author, c.runId])).toEqual([
      ['agent', run.id],
      ['agent', run.id],
      ['agent', run.id],
    ])
    expect(thread[1]?.body).toBe('[x](https://x)')
  })

  test('write_memory_note proposes a pending note (unknown tags dropped) and logs it', async () => {
    const { run } = await connect()
    await t.store.addRepo(await makeOrigin('proj'))
    const r = await client.callTool({
      name: 'write_memory_note',
      arguments: { title: 'Reports', body: 'paginate', tags: ['proj', 'nope'] },
    })
    expect(text(r)).toMatch(/proposed note #\d+/)
    const note = t.db.drizzle.select().from(memoryNotes).get()
    expect(note).toMatchObject({
      title: 'Reports',
      tags: ['proj'],
      author: 'agent',
      state: 'pending',
      runId: run.id,
    })
    expect(
      t.db.drizzle
        .select()
        .from(activity)
        .all()
        .map((a) => a.type),
    ).toEqual(['memory_proposed'])
  })

  test('propose_ticket files a pending follow-up in backlog', async () => {
    const { ticket, run } = await connect()
    const r = await client.callTool({
      name: 'propose_ticket',
      arguments: { title: 'Paginate /reports/all' },
    })
    const id = Number(text(r))
    const proposal = t.db.drizzle.select().from(tickets).where(eq(tickets.id, id)).get()
    expect(proposal).toMatchObject({
      column: 'backlog',
      origin: 'agent',
      proposalState: 'pending',
      followUpOfTicketId: ticket.id,
    })
    const act = t.db.drizzle.select().from(activity).get()
    expect(act).toMatchObject({ type: 'follow_up_filed', ticketId: id, runId: run.id })
  })

  test('report_outcome is what the runner reads back', async () => {
    const { run } = await connect()
    expect(pendingOutcome(t.db, run.id)).toBeNull()
    await client.callTool({
      name: 'report_outcome',
      arguments: { status: 'success', summary: 'ok', testsPassed: 3 },
    })
    expect(pendingOutcome(t.db, run.id)).toEqual({
      status: 'success',
      summary: 'ok',
      testsPassed: 3,
    })
  })
})
