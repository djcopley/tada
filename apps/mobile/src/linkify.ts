/**
 * Comment bodies carry two kinds of link: markdown `[label](url)` (what the agent's `attach_link`
 * tool writes) and bare pasted URLs. Both become tappable spans in the thread; anywhere the body
 * is shown as one line of plain text (card wells, Control), a markdown link collapses to its
 * label so the brackets and parens never show.
 */
export type LinkSegment = { kind: 'text'; text: string } | { kind: 'link'; label: string; url: string }

const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g
const BARE_URL = /https?:\/\/\S+/g
const TRAILING_PUNCTUATION = '.,;:!?]}'

/**
 * `\S+` greedily swallows trailing punctuation that's actually sentence structure, not part of
 * the URL ("...(https://x.com/foo)." would otherwise link to "foo)."). Strip trailing
 * punctuation off the match; `)` is only stripped when the match itself contains no `(`, so a
 * URL whose path legitimately balances parens (e.g. a Wikipedia link) is left alone.
 */
export function trimTrailingPunctuation(url: string): { clean: string; trailing: string } {
  const hasOpenParen = url.includes('(')
  let end = url.length
  while (end > 0) {
    const ch = url.charAt(end - 1)
    if (ch === ')') {
      if (hasOpenParen) break
      end -= 1
      continue
    }
    if (TRAILING_PUNCTUATION.includes(ch)) {
      end -= 1
      continue
    }
    break
  }
  return { clean: url.slice(0, end), trailing: url.slice(end) }
}

function splitBareUrls(text: string, out: LinkSegment[]): void {
  let cursor = 0
  for (const match of text.matchAll(BARE_URL)) {
    const raw = match[0]
    const start = match.index ?? 0
    if (start > cursor) out.push({ kind: 'text', text: text.slice(cursor, start) })
    const { clean, trailing } = trimTrailingPunctuation(raw)
    out.push({ kind: 'link', label: clean, url: clean })
    if (trailing) out.push({ kind: 'text', text: trailing })
    cursor = start + raw.length
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) })
}

/** Body → ordered text/link segments (markdown links first, then bare URLs in the rest). */
export function splitLinks(body: string): LinkSegment[] {
  const out: LinkSegment[] = []
  let cursor = 0
  for (const match of body.matchAll(MARKDOWN_LINK)) {
    const start = match.index ?? 0
    if (start > cursor) splitBareUrls(body.slice(cursor, start), out)
    out.push({ kind: 'link', label: match[1] ?? '', url: match[2] ?? '' })
    cursor = start + match[0].length
  }
  if (cursor < body.length) splitBareUrls(body.slice(cursor), out)
  return out
}

/** The body as one-line-friendly plain text: `[label](url)` → `label`, bare URLs untouched. */
export function plainTextLinks(body: string): string {
  return body.replace(MARKDOWN_LINK, '$1')
}
