import type { ValidationIssue } from "@executioncontrolprotocol/types"
import type { EqlHeader, EqlIntentDoc, EqlReplyCitation, EqlReplyDoc, ParsedLine } from "./ast.js"
import { eqlSyntaxIssue } from "./diagnostics.js"
import { parseLiteral } from "./values.js"

function upper(tokens: string[]): string[] {
  return tokens.map((t) => t.toUpperCase())
}

function parseSummaryFromTokens(tokens: string[], startIndex: number, line: number): {
  summary?: string
  nextIndex: number
} {
  const t = upper(tokens)
  const summaryIndex = t.indexOf("SUMMARY")
  if (summaryIndex < 0) {
    return { nextIndex: startIndex }
  }
  const rest = tokens.slice(summaryIndex + 1).join(" ").trim()
  if (!rest) {
    return { nextIndex: tokens.length }
  }
  const lit = parseLiteral(rest, line)
  if (lit.value !== undefined) {
    return { summary: String(lit.value), nextIndex: tokens.length }
  }
  const unquoted = rest.replace(/^["'\u201C\u201D]|["'\u201C\u201D]$/g, "")
  return { summary: unquoted, nextIndex: tokens.length }
}

function parseTopicFromTokens(tokens: string[]): string | undefined {
  const t = upper(tokens)
  const topicIndex = t.indexOf("TOPIC")
  if (topicIndex < 0 || !tokens[topicIndex + 1]) {
    return undefined
  }
  const summaryIndex = t.indexOf("SUMMARY")
  const end = summaryIndex >= 0 ? summaryIndex : tokens.length
  return tokens.slice(topicIndex + 1, end).join(" ").trim() || undefined
}

export function parseIntentDocument(
  lines: ParsedLine[],
  startIndex: number,
  header: EqlHeader | undefined,
  issues: ValidationIssue[]
): EqlIntentDoc | undefined {
  const row = lines[startIndex]
  if (!row) {
    issues.push(eqlSyntaxIssue(1, "Expected INTENT statement"))
    return undefined
  }
  const t = upper(row.tokens)
  if (t[0] !== "INTENT" || !row.tokens[1]) {
    issues.push(eqlSyntaxIssue(row.line, "INTENT requires a value"))
    return undefined
  }

  let topic = parseTopicFromTokens(row.tokens)
  let summary: string | undefined
  const inlineSummary = parseSummaryFromTokens(row.tokens, 0, row.line)
  summary = inlineSummary.summary

  let i = startIndex + 1
  while (i < lines.length) {
    const child = lines[i]!
    if (child.indent <= row.indent) {
      break
    }
    const ct = upper(child.tokens)
    if (ct[0] === "TOPIC" && child.tokens[1]) {
      topic = child.tokens.slice(1).join(" ").trim()
    } else if (ct[0] === "SUMMARY") {
      const summaryText = child.text.replace(/^\s*SUMMARY\s+/i, "").trim()
      const lit = parseLiteral(summaryText, child.line)
      summary =
        lit.value !== undefined
          ? String(lit.value)
          : summaryText.replace(/^["'\u201C\u201D]|["'\u201C\u201D]$/g, "")
    }
    i++
  }

  return {
    kind: "intent",
    header,
    intent: row.tokens[1]!,
    ...(topic ? { topic } : {}),
    ...(summary ? { summary } : {}),
  }
}

function parseReplyBody(
  lines: ParsedLine[],
  startIndex: number,
  baseIndent: number,
  issues: ValidationIssue[]
): {
  answer?: string
  citations: EqlReplyCitation[]
  suggestedAction?: string
  nextIndex: number
} {
  let answer: string | undefined
  let suggestedAction: string | undefined
  const citations: EqlReplyCitation[] = []
  let i = startIndex
  while (i < lines.length) {
    const row = lines[i]!
    if (row.indent <= baseIndent && i > startIndex) break
    const t = upper(row.tokens)
    if (t[0] === "ANSWER") {
      const answerText = row.text.replace(/^\s*ANSWER\s+/i, "").trim()
      const normalized = answerText.replace(/^\u201C|\u201D$/g, '"')
      const lit = parseLiteral(normalized, row.line)
      if (lit.value !== undefined) answer = String(lit.value)
      else if (
        lit.issues.some((i) => i.message.includes("Unsupported literal")) ||
        (!normalized.startsWith('"') && !normalized.startsWith("'"))
      ) {
        answer = answerText.replace(/^["'\u201C\u201D]|["'\u201C\u201D]$/g, "")
      } else {
        issues.push(...lit.issues)
      }
    } else if (t[0] === "CITATION" && row.tokens[1]) {
      const citation: EqlReplyCitation = { kind: row.tokens[1]!.toLowerCase() }
      const rest = row.tokens.slice(2)
      const quoted = rest.filter((t) => t.startsWith('"') || t.startsWith("'"))
      const unquoted = rest.filter((t) => !t.startsWith('"') && !t.startsWith("'"))
      if (unquoted[0]) citation.id = unquoted[0]
      if (quoted.length > 0) {
        const lit = parseLiteral(quoted.join(" "), row.line)
        if (lit.value !== undefined) citation.detail = String(lit.value)
      }
      citations.push(citation)
    } else if (t[0] === "ACTION" && row.tokens[1]) {
      suggestedAction = row.tokens[1]!.toLowerCase()
    }
    i++
  }
  return { answer, citations, suggestedAction, nextIndex: i }
}

export function parseReplyDocument(
  lines: ParsedLine[],
  startIndex: number,
  header: EqlHeader | undefined,
  issues: ValidationIssue[]
): EqlReplyDoc | undefined {
  const row = lines[startIndex]
  if (!row || upper(row.tokens)[0] !== "REPLY") {
    issues.push(eqlSyntaxIssue(row?.line ?? 1, "Expected REPLY"))
    return undefined
  }

  let answer: string | undefined
  let citations: EqlReplyCitation[] = []

  const body = parseReplyBody(lines, startIndex + 1, row.indent, issues)
  if (body.answer !== undefined) answer = body.answer
  citations = body.citations
  const suggestedAction = body.suggestedAction

  if (!answer) {
    issues.push(eqlSyntaxIssue(row.line, "REPLY requires ANSWER"))
    return undefined
  }

  return {
    kind: "reply",
    header,
    answer,
    citations,
    ...(suggestedAction ? { suggestedAction } : {}),
  }
}
