import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiBoard, ApiRule, ApiTicketDetail } from '@tada/shared'
import { eq } from 'drizzle-orm'
import { describe, expect, test } from 'vitest'
import { FakeAdapter } from '../src/adapters/fake.js'
import type { Adapter } from '../src/adapters/types.js'
import { activity, agentRuns, memoryNotes, settings, tickets } from '../src/db/schema.js'
import { makeOrigin } from './helpers/gitFixtures.js'
import { makeTestApp, seedRun, seedTicket } from './helpers/testApp.js'

const fakeMap = () =>
  new Map<string, Adapter>([['fake', new FakeAdapter({ act: () => new Promise(() => {}) })]])

async function appWithFake() {
  const t = await makeTestApp({ adapters: fakeMap() })
  t.db.drizzle
    .update(settings)
    .set({ adapter: 'fake', model: 'fake-1', concurrency: 0 })
    .where(eq(settings.id, 1))
    .run()
  return t
}

describe('auth', () => {
  test('/health is open; everything else needs the bearer', async () => {
    const t = await makeTestApp()
    expect((await t.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
    expect((await t.app.inject({ method: 'GET', url: '/board' })).statusCode).toBe(401)
    expect((await t.json({ method: 'GET', url: '/board' })).status).toBe(200)
  })

  test('preflight gets CORS headers before auth', async () => {
    const t = await makeTestApp()
    const res = await t.app.inject({
      method: 'OPTIONS',
      url: '/board',
      headers: { origin: 'http://x', 'access-control-request-method': 'PATCH' },
    })
    expect(res.statusCode).toBeLessThan(300)
    expect(res.headers['access-control-allow-origin']).toBe('http://x')
  })
})

describe('board & tickets', () => {
  test('a new ticket lands in backlog by default, or queued on request', async () => {
    const t = await appWithFake()
    const a = await t.json({
      method: 'POST',
      url: '/tickets',
      payload: { title: 'A', description: 'd' },
    })
    expect(a.status).toBe(201)
    expect(a.body).toMatchObject({ column: 'backlog', repoTags: [], run: null, origin: 'human' })
    const b = await t.json({
      method: 'POST',
      url: '/tickets',
      payload: { title: 'B', column: 'queued' },
    })
    expect(b.body.column).toBe('queued')
    expect(b.body.run).toMatchObject({ status: 'queued', attemptNumber: 1 })

    const board = await t.json({ method: 'GET', url: '/board' })
    const cols = board.body as ApiBoard
    expect(cols.backlog.map((x) => x.title)).toEqual(['A'])
    expect(cols.queued.map((x) => x.title)).toEqual(['B'])
    expect(cols.running).toEqual([])
    expect(cols.stopped).toEqual([])
    expect(cols.done).toEqual([])
    const act = t.db.drizzle.select().from(activity).all()
    expect(act.map((r) => r.type)).toEqual(['ticket_created', 'ticket_created'])
  })

  test('a ticket created against a repo is tagged for it; unknown repos are refused', async () => {
    const t = await makeTestApp()
    await t.store.addRepo(await makeOrigin('proj'))
    const ok = await t.json({
      method: 'POST',
      url: '/tickets',
      payload: { title: 'Tagged', repoTags: ['proj', 'proj'] },
    })
    expect(ok.status).toBe(201)
    expect(ok.body.repoTags).toEqual(['proj'])
    // ...and it is on that repo's board straight away, before any run has touched anything.
    const board = (await t.json({ method: 'GET', url: '/board' })).body as ApiBoard
    expect(board.backlog.filter((x) => x.repoTags.includes('proj')).map((x) => x.title)).toEqual([
      'Tagged',
    ])

    const bad = await t.json({
      method: 'POST',
      url: '/tickets',
      payload: { title: 'Ghost', repoTags: ['nope'] },
    })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toContain('nope')
  })

  test('detail carries the thread, runs, follow-ups and parent', async () => {
    const t = await appWithFake()
    const parent = seedTicket(t.db, { title: 'parent' })
    const child = seedTicket(t.db, {
      title: 'child',
      origin: 'agent',
      proposalState: 'pending',
      followUpOfTicketId: parent.id,
      position: 2,
    })
    seedRun(t.db, parent.id, { status: 'failed', finishedAt: new Date() })
    await t.json({ method: 'POST', url: `/tickets/${parent.id}/notes`, payload: { body: 'hi' } })
    const d = (await t.json({ method: 'GET', url: `/tickets/${parent.id}` }))
      .body as ApiTicketDetail
    expect(d.comments.map((c) => c.body)).toEqual(['hi'])
    expect(d.runs).toHaveLength(1)
    expect(d.run?.status).toBe('failed')
    expect(d.followUps).toEqual([{ id: child.id, title: 'child', proposalState: 'pending' }])
    const c = (await t.json({ method: 'GET', url: `/tickets/${child.id}` })).body as ApiTicketDetail
    expect(c.followUpOf).toEqual({ id: parent.id, title: 'parent' })
    expect((await t.json({ method: 'GET', url: '/tickets/999' })).status).toBe(404)
  })

  test('patch edits title and brief; the brief can be edited on a held ticket', async () => {
    const t = await appWithFake()
    const tk = seedTicket(t.db, { column: 'stopped' })
    seedRun(t.db, tk.id, { status: 'held', heldReason: 'permission' })
    const res = await t.json({
      method: 'PATCH',
      url: `/tickets/${tk.id}`,
      payload: { description: 'new brief' },
    })
    expect(res.status).toBe(200)
    expect(res.body.description).toBe('new brief')
    expect(
      (await t.json({ method: 'PATCH', url: `/tickets/${tk.id}`, payload: { title: '' } })).status,
    ).toBe(400)
  })

  test('move: humans reach backlog/queued/done, never running/stopped', async () => {
    const t = await appWithFake()
    const tk = seedTicket(t.db)
    for (const column of ['running', 'stopped']) {
      const res = await t.json({
        method: 'POST',
        url: `/tickets/${tk.id}/move`,
        payload: { column },
      })
      expect(res.status).toBe(400) // zod rejects the enum
    }
    const q = await t.json({
      method: 'POST',
      url: `/tickets/${tk.id}/move`,
      payload: { column: 'queued' },
    })
    expect(q.status).toBe(200)
    expect(q.body.column).toBe('queued')
    expect(q.body.run.status).toBe('queued')

    // reorder within queued keeps the same run
    const re = await t.json({
      method: 'POST',
      url: `/tickets/${tk.id}/move`,
      payload: { column: 'queued', position: 0.5 },
    })
    expect(re.body.position).toBe(0.5)
    expect(t.db.drizzle.select().from(agentRuns).all()).toHaveLength(1)

    // back to backlog cancels the queued run
    const b = await t.json({
      method: 'POST',
      url: `/tickets/${tk.id}/move`,
      payload: { column: 'backlog' },
    })
    expect(b.body.column).toBe('backlog')
    expect(b.body.run.status).toBe('cancelled')

    // done sets doneAt; undo clears it and leaves a receipt
    const d = await t.json({
      method: 'POST',
      url: `/tickets/${tk.id}/move`,
      payload: { column: 'done' },
    })
    expect(d.body.doneAt).not.toBeNull()
    const u = await t.json({
      method: 'POST',
      url: `/tickets/${tk.id}/move`,
      payload: { column: 'backlog' },
    })
    expect(u.body.doneAt).toBeNull()
    expect(
      t.db.drizzle
        .select()
        .from(activity)
        .all()
        .map((r) => r.type),
    ).toContain('undone')
  })

  test('move: a live run owns the card — only backlog (stop) is allowed', async () => {
    const t = await appWithFake()
    const tk = seedTicket(t.db, { column: 'stopped' })
    seedRun(t.db, tk.id, { status: 'held', heldReason: 'question' })
    expect(
      (await t.json({ method: 'POST', url: `/tickets/${tk.id}/move`, payload: { column: 'done' } }))
        .status,
    ).toBe(409)
    expect(
      (
        await t.json({
          method: 'POST',
          url: `/tickets/${tk.id}/move`,
          payload: { column: 'queued' },
        })
      ).status,
    ).toBe(409)
    expect((await t.json({ method: 'DELETE', url: `/tickets/${tk.id}` })).status).toBe(409)
  })

  test('a pending proposal cannot be queued until kept; dismiss deletes it', async () => {
    const t = await appWithFake()
    const p = seedTicket(t.db, { origin: 'agent', proposalState: 'pending' })
    expect(
      (
        await t.json({
          method: 'POST',
          url: `/tickets/${p.id}/move`,
          payload: { column: 'queued' },
        })
      ).status,
    ).toBe(403)
    const keep = await t.json({
      method: 'POST',
      url: `/tickets/${p.id}/proposal`,
      payload: { action: 'keep' },
    })
    expect(keep.body.proposalState).toBeNull()
    expect(
      (
        await t.json({
          method: 'POST',
          url: `/tickets/${p.id}/proposal`,
          payload: { action: 'keep' },
        })
      ).status,
    ).toBe(404)
    const p2 = seedTicket(t.db, { origin: 'agent', proposalState: 'pending', position: 5 })
    expect(
      (
        await t.json({
          method: 'POST',
          url: `/tickets/${p2.id}/proposal`,
          payload: { action: 'dismiss' },
        })
      ).status,
    ).toBe(204)
    expect(t.db.drizzle.select().from(tickets).where(eq(tickets.id, p2.id)).get()).toBeUndefined()
  })

  test('duplicate and delete', async () => {
    const t = await appWithFake()
    const tk = seedTicket(t.db, { title: 'orig', description: 'brief', column: 'done' })
    const dup = await t.json({ method: 'POST', url: `/tickets/${tk.id}/duplicate` })
    expect(dup.status).toBe(201)
    expect(dup.body).toMatchObject({ title: 'orig', description: 'brief', column: 'backlog' })
    expect((await t.json({ method: 'DELETE', url: `/tickets/${tk.id}` })).status).toBe(204)
    expect((await t.json({ method: 'GET', url: `/tickets/${tk.id}` })).status).toBe(404)
  })
})

describe('rules', () => {
  test('the default table is seeded: never before allow, pr create and merge ask, publish flags', async () => {
    const t = await makeTestApp()
    const list = (await t.json({ method: 'GET', url: '/rules' })).body as ApiRule[]
    expect(list.map((r) => [r.title, r.decision, r.publishes, r.source])).toEqual([
      ['Force-push or touch main', 'never', true, 'default'],
      ['Push a branch', 'allow', true, 'default'],
      ['Open a pull request', 'ask', true, 'default'],
      ['Merge or close a pull request', 'ask', true, 'default'],
    ])
  })

  test('crud, and holdingCount reflects held runs', async () => {
    const t = await makeTestApp()
    const created = await t.json({
      method: 'POST',
      url: '/rules',
      payload: { title: 'Run a migration', patterns: ['*db:migrate*'], decision: 'ask' },
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      tool: 'Bash',
      decision: 'ask',
      source: 'human',
      publishes: false,
    })
    const patched = await t.json({
      method: 'PATCH',
      url: `/rules/${created.body.id}`,
      payload: { decision: 'allow' },
    })
    expect(patched.body.decision).toBe('allow')

    const tk = seedTicket(t.db, { column: 'stopped' })
    seedRun(t.db, tk.id, {
      status: 'held',
      heldReason: 'permission',
      hold: {
        reason: 'permission',
        tool: 'Bash',
        summary: 'x',
        ruleId: created.body.id,
        ruleTitle: 'Run a migration',
        publishes: false,
      },
    })
    const list = (await t.json({ method: 'GET', url: '/rules' })).body as ApiRule[]
    expect(list.find((r) => r.id === created.body.id)?.holdingCount).toBe(1)
    expect((await t.json({ method: 'DELETE', url: `/rules/${created.body.id}` })).status).toBe(204)
    expect((await t.json({ method: 'DELETE', url: `/rules/${created.body.id}` })).status).toBe(404)
  })
})

describe('settings & sources', () => {
  test('one settings row; model/effort validated against the harness', async () => {
    const t = await makeTestApp({ adapters: fakeMap() })
    const s = await t.json({ method: 'GET', url: '/settings' })
    expect(s.body).toMatchObject({
      adapter: 'claude',
      model: 'sonnet',
      effort: 'medium',
      concurrency: 2,
      pingChannel: 'push',
    })
    expect(
      (await t.json({ method: 'PATCH', url: '/settings', payload: { adapter: 'nope' } })).status,
    ).toBe(400)
    expect(
      (
        await t.json({
          method: 'PATCH',
          url: '/settings',
          payload: { adapter: 'fake', model: 'sonnet' },
        })
      ).status,
    ).toBe(400)
    // a harness switch without a model falls back to the harness's first model
    const sw = await t.json({ method: 'PATCH', url: '/settings', payload: { adapter: 'fake' } })
    expect(sw.body).toMatchObject({ adapter: 'fake', model: 'fake-1', effort: 'medium' })
    const lim = await t.json({
      method: 'PATCH',
      url: '/settings',
      payload: { concurrency: 3, timeoutMs: 600_000, pingChannel: 'off', repingMs: 0 },
    })
    expect(lim.body).toMatchObject({
      concurrency: 3,
      timeoutMs: 600_000,
      pingChannel: 'off',
      repingMs: 0,
    })
    expect(
      (await t.json({ method: 'PATCH', url: '/settings', payload: { concurrency: 0 } })).status,
    ).toBe(400)
  })

  test('sources: add a repo (clone), a folder, remove; names unique; status lists them', async () => {
    const t = await makeTestApp()
    const origin = await makeOrigin('proj')
    const r = await t.json({
      method: 'POST',
      url: '/sources',
      payload: { type: 'repo', url: origin },
    })
    expect(r.status).toBe(201)
    expect(r.body).toEqual([{ type: 'repo', name: 'proj', url: origin, defaultBranch: 'main' }])
    expect(existsSync(t.store.cloneDir('proj'))).toBe(true)
    expect(
      (await t.json({ method: 'POST', url: '/sources', payload: { type: 'repo', url: origin } }))
        .status,
    ).toBe(409)

    const folder = mkdtempSync(join(tmpdir(), 'tada-folder-'))
    const f = await t.json({
      method: 'POST',
      url: '/sources',
      payload: { type: 'folder', path: folder },
    })
    expect(f.body).toHaveLength(2)
    expect(
      (
        await t.json({
          method: 'POST',
          url: '/sources',
          payload: { type: 'folder', path: 'relative' },
        })
      ).status,
    ).toBe(400)

    const st = await t.json({ method: 'GET', url: '/status' })
    expect(st.body.sources).toHaveLength(2)
    expect((await t.json({ method: 'DELETE', url: '/sources/proj' })).body).toHaveLength(1)
    expect(existsSync(t.store.cloneDir('proj'))).toBe(false)
    expect((await t.json({ method: 'DELETE', url: '/sources/nope' })).status).toBe(404)
  })
})

describe('memory', () => {
  test('one list: create, edit, tag validation, keep/dismiss proposals', async () => {
    const t = await makeTestApp()
    const c = await t.json({
      method: 'POST',
      url: '/memory',
      payload: { title: 'Safety', body: 'never force-push' },
    })
    expect(c.status).toBe(201)
    expect(c.body).toMatchObject({ title: 'Safety', tags: [], author: 'human', state: 'kept' })
    // a tag must name a connected repo
    expect(
      (
        await t.json({
          method: 'POST',
          url: '/memory',
          payload: { title: 'x', body: 'y', tags: ['nope'] },
        })
      ).status,
    ).toBe(400)
    await t.store.addRepo(await makeOrigin('proj'))
    const tagged = await t.json({
      method: 'POST',
      url: '/memory',
      payload: { title: 'Testing', body: 'pnpm test', tags: ['proj'] },
    })
    expect(tagged.body.tags).toEqual(['proj'])

    const [proposed] = t.db.drizzle
      .insert(memoryNotes)
      .values({ title: 'from agent', body: 'b', author: 'agent', state: 'pending', runId: 1 })
      .returning()
      .all()
    if (!proposed) throw new Error('insert failed')
    // editing a proposal takes ownership
    const ed = await t.json({
      method: 'PATCH',
      url: `/memory/${proposed.id}`,
      payload: { body: 'edited' },
    })
    expect(ed.body).toMatchObject({ body: 'edited', author: 'human', state: 'kept' })
    expect((await t.json({ method: 'POST', url: `/memory/${proposed.id}/keep` })).status).toBe(404) // no longer pending

    const [p2] = t.db.drizzle
      .insert(memoryNotes)
      .values({ title: 'p2', body: 'b', author: 'agent', state: 'pending' })
      .returning()
      .all()
    if (!p2) throw new Error('insert failed')
    expect((await t.json({ method: 'POST', url: `/memory/${p2.id}/dismiss` })).status).toBe(204)
    const all = (await t.json({ method: 'GET', url: '/memory' })).body
    expect(all.map((n: { title: string }) => n.title)).toEqual(['Safety', 'Testing', 'from agent'])
    expect(
      t.db.drizzle
        .select()
        .from(activity)
        .all()
        .map((r) => r.type),
    ).toContain('note_discarded')
    expect((await t.json({ method: 'DELETE', url: `/memory/${proposed.id}` })).status).toBe(204)
  })
})

describe('runs', () => {
  test('detail, events, transcript 404 before start', async () => {
    const t = await makeTestApp()
    const tk = seedTicket(t.db, { title: 'T', repoTags: ['proj'] })
    const run = seedRun(t.db, tk.id)
    const d = await t.json({ method: 'GET', url: `/runs/${run.id}` })
    expect(d.body).toMatchObject({
      ticketTitle: 'T',
      repoTags: ['proj'],
      status: 'queued',
      hold: null,
    })
    expect(d.body.runToken).toBeUndefined()
    expect((await t.json({ method: 'GET', url: `/runs/${run.id}/events` })).body).toEqual([])
    expect((await t.json({ method: 'GET', url: `/runs/${run.id}/transcript` })).status).toBe(404)
  })

  test('the diff answers only at a publish gate', async () => {
    const t = await makeTestApp()
    const tk = seedTicket(t.db, { column: 'stopped' })
    const running = seedRun(t.db, tk.id, { status: 'running' })
    expect((await t.json({ method: 'GET', url: `/runs/${running.id}/diff` })).status).toBe(409)
    const question = seedRun(t.db, tk.id, {
      status: 'held',
      heldReason: 'question',
      hold: { reason: 'question', question: 'q', options: [] },
    })
    expect((await t.json({ method: 'GET', url: `/runs/${question.id}/diff` })).status).toBe(409)
    const nonPublish = seedRun(t.db, tk.id, {
      status: 'held',
      heldReason: 'permission',
      hold: {
        reason: 'permission',
        tool: 'Bash',
        summary: 'pnpm db:migrate',
        ruleId: 1,
        ruleTitle: 'x',
        publishes: false,
      },
    })
    expect((await t.json({ method: 'GET', url: `/runs/${nonPublish.id}/diff` })).status).toBe(409)
    const publish = seedRun(t.db, tk.id, {
      status: 'held',
      heldReason: 'permission',
      hold: {
        reason: 'permission',
        tool: 'Bash',
        summary: 'gh pr create',
        ruleId: 3,
        ruleTitle: 'Open a pull request',
        publishes: true,
      },
    })
    const ok = await t.json({ method: 'GET', url: `/runs/${publish.id}/diff` })
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ runId: publish.id, repos: [] })
  })

  test('hold resolutions 409 for a run this process is not holding', async () => {
    const t = await makeTestApp()
    const tk = seedTicket(t.db, { column: 'stopped' })
    const run = seedRun(t.db, tk.id, { status: 'held', heldReason: 'permission' })
    expect(
      (await t.json({ method: 'POST', url: `/runs/${run.id}/approve`, payload: {} })).status,
    ).toBe(409)
    expect(
      (await t.json({ method: 'POST', url: `/runs/${run.id}/deny`, payload: { note: 'x' } }))
        .status,
    ).toBe(409)
  })

  test('activity feed is newest first with ticket titles', async () => {
    const t = await makeTestApp()
    await t.json({ method: 'POST', url: '/tickets', payload: { title: 'one' } })
    await t.json({ method: 'POST', url: '/tickets', payload: { title: 'two' } })
    const feed = await t.json({ method: 'GET', url: '/activity?limit=1' })
    expect(feed.body).toHaveLength(1)
    expect(feed.body[0]).toMatchObject({ type: 'ticket_created', ticketTitle: 'two' })
    expect((await t.json({ method: 'GET', url: '/activity?limit=x' })).status).toBe(400)
  })

  test('push tokens register once', async () => {
    const t = await makeTestApp()
    expect(
      (
        await t.json({
          method: 'POST',
          url: '/push-tokens',
          payload: { token: 'ExponentPushToken[a]' },
        })
      ).status,
    ).toBe(201)
    expect(
      (
        await t.json({
          method: 'POST',
          url: '/push-tokens',
          payload: { token: 'ExponentPushToken[a]' },
        })
      ).status,
    ).toBe(201)
  })
})
