import type { ApiRun } from '@tada/shared'
import { render, type RenderResult } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import { HoldActions } from '../src/components/gate/HoldActions'

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
}))

const idle = () => ({ mutate: jest.fn(), isPending: false, variables: undefined })
jest.mock('../src/api/queries', () => ({
  useApprove: () => idle(),
  useDeny: () => idle(),
  useAnswer: () => idle(),
  useContinueRun: () => idle(),
  useCancelRun: () => idle(),
  useMoveTicket: () => idle(),
  useRerun: () => idle(),
}))

const LONG = "The tada ticket board itself — I'll handle closing/removing tickets manually, just close out this run"

function questionRun(): ApiRun {
  return {
    id: 7,
    ticketId: 3,
    status: 'held',
    heldReason: 'question',
    hold: { reason: 'question', question: 'which board?', options: [LONG, 'A backlog file in a repo', 'Cancel'] },
  } as unknown as ApiRun
}

function permissionRun(): ApiRun {
  return {
    id: 8,
    ticketId: 3,
    status: 'held',
    heldReason: 'permission',
    hold: { reason: 'permission', tool: 'Bash', publishes: false },
  } as unknown as ApiRun
}

const flat = (view: RenderResult, testID: string) => StyleSheet.flatten(view.getByTestId(testID).props.style) ?? {}

describe('HoldActions layout', () => {
  test('question options stack full width instead of splitting a wrapping row', async () => {
    const view = await render(<HoldActions run={questionRun()} ticketId={3} testID="acts" />)

    expect(flat(view, 'acts').flexDirection).toBe('column')
    for (const id of [`hold-option-${LONG}`, 'hold-option-Cancel', 'hold-answer']) {
      const style = flat(view, id)
      expect(style.alignSelf).toBe('stretch')
      expect(style.flexGrow).toBeUndefined()
    }
  })

  test('stretch grows buttons from their own width instead of giving each an equal slice', async () => {
    const view = await render(<HoldActions run={permissionRun()} ticketId={3} stretch testID="acts" />)

    expect(flat(view, 'acts').flexWrap).toBe('wrap')
    for (const id of ['hold-approve', 'hold-always-allow', 'hold-deny']) {
      const style = flat(view, id)
      expect(style.flexGrow).toBe(1)
      // flexBasis 0 (what `flex: 1` means) is the bug: it sizes every button alike, so a label
      // longer than its slice runs over the next button.
      expect(style.flexBasis).toBe('auto')
    }
  })

  test('stretch still stacks question options, whose labels are whole sentences', async () => {
    const view = await render(<HoldActions run={questionRun()} ticketId={3} stretch testID="acts" />)

    expect(flat(view, 'acts').flexDirection).toBe('column')
    expect(flat(view, `hold-option-${LONG}`).alignSelf).toBe('stretch')
  })

  test('a wide permission row stays a wrapping row of content-sized buttons', async () => {
    const view = await render(<HoldActions run={permissionRun()} ticketId={3} testID="acts" />)

    const row = flat(view, 'acts')
    expect(row.flexDirection).toBe('row')
    expect(row.flexWrap).toBe('wrap')
    expect(flat(view, 'hold-approve').alignSelf).toBeUndefined()
  })

  test('long option labels wrap inside the button instead of overflowing it', async () => {
    const view = await render(<HoldActions run={questionRun()} ticketId={3} testID="acts" />)

    const label = view.getByText(LONG)
    expect(label.props.numberOfLines).toBe(3)
  })
})
