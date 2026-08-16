import { act, renderHook } from '@testing-library/react-native'
import {
  activityGlyph,
  elapsedLabel,
  failureLine,
  headlineFor,
  hhmm,
  isSinceLocalMidnight,
  narrowNeedsYouMeta,
  narrowOvernightSubline,
  overnightSubline,
  prNumberFromUrl,
  runStatLine,
  slotPillText,
  splitOnQuotedTitle,
  useNowTick,
} from '../src/control'

function run(overrides: Partial<Parameters<typeof runStatLine>[0]> = {}) {
  return {
    id: 1,
    ticketId: 1,
    adapter: 'claude',
    model: 'sonnet',
    effort: 'default',
    attemptNumber: 1,
    status: 'needs_review' as const,
    branch: null,
    prUrl: null,
    summary: null,
    diffAdditions: null,
    diffDeletions: null,
    testsPassed: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('headlineFor', () => {
  test('zero is "All quiet"', () => {
    expect(headlineFor(0)).toBe('All quiet')
  })
  test('one is singular', () => {
    expect(headlineFor(1)).toBe('One thing needs you')
  })
  test('two+ is plural', () => {
    expect(headlineFor(2)).toBe('Two things need you')
  })
  test('falls back to a digit above the word list', () => {
    expect(headlineFor(11)).toBe('11 things need you')
  })
})

describe('overnightSubline', () => {
  test('degrades gracefully when nothing ran and no notes', () => {
    expect(overnightSubline(0, 0)).toBe('nothing ran overnight')
  })
  test('runs only', () => {
    expect(overnightSubline(3, 0)).toBe('3 ran overnight')
  })
  test('runs plus one note (singular)', () => {
    expect(overnightSubline(3, 1)).toBe('3 ran overnight · memory grew by one note')
  })
  test('runs plus several notes', () => {
    expect(overnightSubline(3, 4)).toBe('3 ran overnight · memory grew by 4 notes')
  })
})

describe('isSinceLocalMidnight', () => {
  test('a timestamp from today is since midnight', () => {
    const now = new Date(2026, 7, 14, 10, 0, 0)
    expect(isSinceLocalMidnight(new Date(2026, 7, 14, 3, 12).toISOString(), now)).toBe(true)
  })
  test('a timestamp from yesterday is not', () => {
    const now = new Date(2026, 7, 14, 10, 0, 0)
    expect(isSinceLocalMidnight(new Date(2026, 7, 13, 23, 59).toISOString(), now)).toBe(false)
  })

  test('the default `now` goes through Date.now(), so mocking Date.now() freezes it', () => {
    // Regression: `new Date()` (no args) does NOT consult a jest.spyOn(Date, 'now') mock — only
    // an explicit `Date.now()` call does. The default param must route through Date.now() or
    // every caller relying on the default (and every test that freezes time this way) silently
    // uses the real wall clock instead.
    const frozen = new Date(2026, 7, 14, 10, 0, 0).getTime()
    jest.spyOn(Date, 'now').mockReturnValue(frozen)
    try {
      expect(isSinceLocalMidnight(new Date(2026, 7, 14, 3, 12).toISOString())).toBe(true)
      expect(isSinceLocalMidnight(new Date(2026, 7, 13, 23, 59).toISOString())).toBe(false)
    } finally {
      jest.restoreAllMocks()
    }
  })
})

describe('activityGlyph', () => {
  test('accepted -> ✱ okText', () => {
    expect(activityGlyph('accepted')).toEqual({ glyph: '✱', colorKey: 'okText' })
  })
  test('follow_up_filed -> + liveText', () => {
    expect(activityGlyph('follow_up_filed')).toEqual({ glyph: '+', colorKey: 'liveText' })
  })
  test('memory_written -> ✎ liveText', () => {
    expect(activityGlyph('memory_written')).toEqual({ glyph: '✎', colorKey: 'liveText' })
  })
  test('run_failed -> ✕ failText', () => {
    expect(activityGlyph('run_failed')).toEqual({ glyph: '✕', colorKey: 'failText' })
  })
  test('unmapped types render plain', () => {
    expect(activityGlyph('run_started')).toBeNull()
    expect(activityGlyph('ticket_created')).toBeNull()
  })
})

describe('splitOnQuotedTitle', () => {
  test('splits around the quoted title', () => {
    expect(splitOnQuotedTitle('You accepted "Prune CI artifacts" — freed 41 GB', 'Prune CI artifacts')).toEqual({
      before: 'You accepted ',
      title: 'Prune CI artifacts',
      after: ' — freed 41 GB',
    })
  })
  test('returns null when there is no title', () => {
    expect(splitOnQuotedTitle('Agent wrote to parlor memory', null)).toBeNull()
  })
  test('returns null when the title is not quoted in the message', () => {
    expect(splitOnQuotedTitle('Agent wrote to parlor memory', 'Prune CI artifacts')).toBeNull()
  })
})

describe('hhmm', () => {
  test('pads single-digit hours and minutes', () => {
    expect(hhmm(new Date(2026, 7, 14, 9, 6).toISOString())).toBe('09:06')
  })
})

describe('prNumberFromUrl', () => {
  test('pulls the trailing number', () => {
    expect(prNumberFromUrl('https://github.com/acme/parlor/pull/481')).toBe('481')
  })
  test('null for no url', () => {
    expect(prNumberFromUrl(null)).toBeNull()
  })
})

describe('runStatLine', () => {
  test('omits missing pieces', () => {
    expect(runStatLine(run({ attemptNumber: 2 }))).toBe('attempt 2')
  })
  test('includes every present piece in order', () => {
    expect(
      runStatLine(
        run({
          attemptNumber: 2,
          prUrl: 'https://github.com/acme/parlor/pull/481',
          diffAdditions: 412,
          diffDeletions: 38,
          testsPassed: 214,
        }),
      ),
    ).toBe('attempt 2 · pr #481 · +412 −38 · 214 tests pass')
  })
  test('empty string with no run', () => {
    expect(runStatLine(undefined)).toBe('')
  })
})

describe('failureLine', () => {
  test('uses the summary when present', () => {
    expect(failureLine(run({ attemptNumber: 1, summary: 'timed out at 30m' }))).toBe(
      'attempt 1 · timed out at 30m',
    )
  })
  test('falls back to plain "failed"', () => {
    expect(failureLine(run({ attemptNumber: 1, summary: null }))).toBe('attempt 1 · failed')
  })
})

describe('elapsedLabel', () => {
  const now = new Date(2026, 7, 14, 10, 0, 0).getTime()
  test('minutes only', () => {
    expect(elapsedLabel(new Date(2026, 7, 14, 9, 48).toISOString(), now)).toBe('12m')
  })
  test('hours and minutes', () => {
    expect(elapsedLabel(new Date(2026, 7, 14, 7, 56).toISOString(), now)).toBe('2h 4m')
  })
  test('exact hour omits minutes', () => {
    expect(elapsedLabel(new Date(2026, 7, 14, 8, 0).toISOString(), now)).toBe('2h')
  })
  test('no startedAt is 0m', () => {
    expect(elapsedLabel(null, now)).toBe('0m')
  })
})

describe('useNowTick', () => {
  test('re-renders with an advanced timestamp on each interval tick', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-14T10:00:00.000Z') })
    const { result } = await renderHook(() => useNowTick(30_000))
    const first = result.current

    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000)
    })

    expect(result.current).toBe(first + 30_000)
    jest.useRealTimers()
  })
})

describe('slotPillText', () => {
  test('singular', () => {
    expect(slotPillText(1, 'Wire up webhook retries with backoff')).toBe(
      '1 slot free — next: Wire up webhook retries with backoff',
    )
  })
  test('plural', () => {
    expect(slotPillText(3, 'Rotate the staging TLS cert')).toBe('3 slots free — next: Rotate the staging TLS cert')
  })
})

describe('narrowNeedsYouMeta', () => {
  const now = new Date(2026, 7, 14, 10, 0, 0).getTime()
  const createdAt = new Date(2026, 7, 14, 8, 0, 0).toISOString()

  test('in-review with a PR', () => {
    expect(narrowNeedsYouMeta('parlor', createdAt, now, false, run({ prUrl: 'https://github.com/acme/parlor/pull/481' }))).toBe(
      'parlor · 2h · pr #481',
    )
  })

  test('in-review with no PR yet omits the marker, not the whole line', () => {
    expect(narrowNeedsYouMeta('parlor', createdAt, now, false, run())).toBe('parlor · 2h')
  })

  test('in-review with no run at all', () => {
    expect(narrowNeedsYouMeta('parlor', createdAt, now, false, undefined)).toBe('parlor · 2h')
  })

  test('failed with a timeout summary gets the short "timed out" marker, not the full text', () => {
    expect(narrowNeedsYouMeta('parlor', createdAt, now, true, run({ summary: 'timed out at 30m' }))).toBe(
      'parlor · 2h · timed out',
    )
    expect(narrowNeedsYouMeta('parlor', createdAt, now, true, run({ summary: 'Timeout after 1800000ms' }))).toBe(
      'parlor · 2h · timed out',
    )
  })

  test('failed with a non-timeout summary gets the short "failed" marker, never the full summary', () => {
    expect(
      narrowNeedsYouMeta(
        'parlor',
        createdAt,
        now,
        true,
        run({ summary: 'vite 6 migration is bigger than a bump — suggest splitting the ticket' }),
      ),
    ).toBe('parlor · 2h · failed')
  })

  test('failed with no summary falls back to "failed"', () => {
    expect(narrowNeedsYouMeta('parlor', createdAt, now, true, run({ summary: null }))).toBe('parlor · 2h · failed')
  })
})

describe('narrowOvernightSubline', () => {
  test('degrades gracefully when nothing ran', () => {
    expect(narrowOvernightSubline(0, null)).toBe('nothing ran overnight')
  })
  test('runs with no failure', () => {
    expect(narrowOvernightSubline(3, null)).toBe('3 ran overnight')
  })
  test('runs with a failure mentions its time', () => {
    expect(narrowOvernightSubline(3, '03:12')).toBe('3 ran overnight · at 03:12 one failed')
  })
  test('several failures count them from the first one', () => {
    expect(narrowOvernightSubline(13, '03:12', 4)).toBe('13 ran overnight · since 03:12 four failed')
  })
})
