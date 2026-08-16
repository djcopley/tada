import { execa } from 'execa'

export async function git(cwd: string, ...args: string[]): Promise<string> {
  // GIT_TERMINAL_PROMPT=0: a clone/fetch of a private or nonexistent remote fails fast instead
  // of hanging forever waiting for credentials on a daemon that has no terminal.
  const { stdout } = await execa('git', args, { cwd, env: { GIT_TERMINAL_PROMPT: '0' } })
  return stdout.trim()
}
