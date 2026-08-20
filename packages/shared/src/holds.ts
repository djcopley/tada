import type { Hold } from './domain.js'

/** One line naming what stopped the run — the body of every hold ping, on any channel. */
export function holdPingText(hold: Hold): string {
  switch (hold.reason) {
    case 'permission':
      return `wants to: ${hold.ruleTitle} — ${hold.summary}`
    case 'question':
      return hold.question
    case 'time':
      return 'out of time — continue, or stop it'
  }
}
