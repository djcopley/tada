/**
 * Answers to `ask_user`, keyed by run. The gate stores the human's answer here just before it
 * lets the tool call through (it also passes it as `updatedInput.answer`); the MCP tool handler
 * takes it from whichever channel delivered it. Process-local on purpose — a question and its
 * answer never outlive the live run that asked.
 */
const answers = new Map<number, string>()

export function storeAnswer(runId: number, answer: string): void {
  answers.set(runId, answer)
}

export function takeAnswer(runId: number): string | undefined {
  const a = answers.get(runId)
  answers.delete(runId)
  return a
}
