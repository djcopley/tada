import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { openDb } from '../src/db/index.js'
import { configDir } from '../src/paths.js'
import { makeAppDeps } from './helpers/appDeps.js'
import { isolateXdg } from './helpers/gitFixtures.js'

function makeDb() {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tada-app-')), 'tada.db'))
}

describe('buildApp', () => {
  beforeEach(() => {
    isolateXdg()
  })

  test('GET /health returns 200 with no auth', async () => {
    const app = buildApp(makeAppDeps(makeDb(), loadConfig()))
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  test('other routes require bearer auth', async () => {
    const app = buildApp(makeAppDeps(makeDb(), loadConfig()))
    app.get('/whoami', async () => ({ ok: true }))
    await app.ready()

    const noAuth = await app.inject({ method: 'GET', url: '/whoami' })
    expect(noAuth.statusCode).toBe(401)

    const wrongAuth = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer wrong-token' },
    })
    expect(wrongAuth.statusCode).toBe(401)
  })

  test('correct bearer token passes', async () => {
    const config = loadConfig()
    const app = buildApp(makeAppDeps(makeDb(), config))
    app.get('/whoami', async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${config.bearerToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  test('GET /health?x=1 returns 200 with no auth (query string stripped before comparison)', async () => {
    const app = buildApp(makeAppDeps(makeDb(), loadConfig()))
    const res = await app.inject({ method: 'GET', url: '/health?x=1' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  test('paths merely prefixed with /mcp (not /mcp or /mcp/...) still require bearer auth', async () => {
    const app = buildApp(makeAppDeps(makeDb(), loadConfig()))
    app.get('/mcpadmin', async () => ({ ok: true }))
    app.get('/mcpfoo', async () => ({ ok: true }))
    await app.ready()

    const noAuthAdmin = await app.inject({ method: 'GET', url: '/mcpadmin' })
    expect(noAuthAdmin.statusCode).toBe(401)

    const noAuthFoo = await app.inject({ method: 'GET', url: '/mcpfoo?x=1' })
    expect(noAuthFoo.statusCode).toBe(401)
  })
})

describe('loadConfig', () => {
  beforeEach(() => {
    isolateXdg()
  })

  test('creates config.json with generated token and default port on first run', () => {
    const configPath = join(configDir(), 'config.json')
    expect(existsSync(configPath)).toBe(false)

    const config = loadConfig()

    expect(config.port).toBe(4242)
    expect(config.host).toBe('0.0.0.0')
    expect(config.bearerToken).toMatch(/^[0-9a-f]{64}$/)
    expect(existsSync(configPath)).toBe(true)

    const onDisk = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(onDisk.bearerToken).toBe(config.bearerToken)
    expect(onDisk.port).toBe(4242)
    expect(onDisk.host).toBe('0.0.0.0')
  })

  test('a config.json written before `host` existed still loads with the default', () => {
    const dir = configDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ port: 4242, bearerToken: 'a'.repeat(64) }, null, 2),
    )

    const config = loadConfig()
    expect(config.host).toBe('0.0.0.0')
  })

  test('second call reads back the same token', () => {
    const first = loadConfig()
    const second = loadConfig()
    expect(second.bearerToken).toBe(first.bearerToken)
    expect(second.port).toBe(first.port)
  })
})
