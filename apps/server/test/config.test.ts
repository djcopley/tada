import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { loadConfig } from '../src/config.js'

function isolateConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tada-config-'))
  process.env.TADA_CONFIG_DIR = dir
  return dir
}

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.TADA_CONFIG_DIR
  })

  test('generates VAPID keys on first boot and persists them', () => {
    const dir = isolateConfigDir()
    const config = loadConfig()

    expect(config.vapidPublicKey.length).toBeGreaterThan(0)
    expect(config.vapidPrivateKey.length).toBeGreaterThan(0)
    expect(config.vapidSubject).toBe('mailto:daniel@copley.dev')

    const onDisk = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
    expect(onDisk.vapidPublicKey).toBe(config.vapidPublicKey)
    expect(onDisk.vapidPrivateKey).toBe(config.vapidPrivateKey)
  })

  test('keeps the same keys across loads — regenerating would kill every subscription', () => {
    isolateConfigDir()
    const first = loadConfig()
    const second = loadConfig()
    expect(second.vapidPublicKey).toBe(first.vapidPublicKey)
    expect(second.vapidPrivateKey).toBe(first.vapidPrivateKey)
  })

  test('backfills keys into a config file written before web push existed', () => {
    const dir = isolateConfigDir()
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ port: 4242, host: '0.0.0.0', bearerToken: 'a'.repeat(64) }),
    )

    const config = loadConfig()
    expect(config.bearerToken).toBe('a'.repeat(64))
    expect(config.vapidPublicKey.length).toBeGreaterThan(0)

    const onDisk = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
    expect(onDisk.vapidPublicKey).toBe(config.vapidPublicKey)
  })
})
