import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { configDir } from './paths.js'

const configSchema = z.object({
  port: z.number().int().default(4242),
  bearerToken: z.string().min(32),
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(): Config {
  const dir = configDir()
  const path = join(dir, 'config.json')

  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true })
    const config: Config = { port: 4242, bearerToken: randomBytes(32).toString('hex') }
    writeFileSync(path, JSON.stringify(config, null, 2))
    return config
  }

  const raw = JSON.parse(readFileSync(path, 'utf8'))
  return configSchema.parse(raw)
}
