import type { EcpIntent, EcpIntentValue } from "@executioncontrolprotocol/types"
import { isClearAllStepsRequest } from "./patch-clear-intent.js"

const SUMMARY_MAX_LENGTH = 120

/** Canonical intent values accepted by {@link ECP_INTENT_SCHEMA}. @category Harness */
export const CLASSIFIED_INTENT_VALUES = [
  "faq",
  "workflow-create",
  "workflow-patch",
  "general",
] as const satisfies readonly EcpIntentValue[]

const CLASSIFIED_INTENT_VALUE_SET = new Set<string>(CLASSIFIED_INTENT_VALUES)

/**
 * High-confidence intent from user message alone (nano harness correction layer).
 * @category Harness
 */
export function inferIntentFromMessageHeuristic(message: string): EcpIntentValue | undefined {
  const msg = message.trim()
  if (/^what is ecp\??$/i.test(msg)) {
    return "faq"
  }
  if (/^how\s+(?:does|do)\b/i.test(msg) && /\bwork\b/i.test(msg)) {
    return "faq"
  }
  if (/^how do i patch\b/i.test(msg)) {
    return "faq"
  }
  if (/^(hello|hi|bonjour|hola|thanks)\b/i.test(msg)) {
    return "general"
  }
  if (/tell me a joke/i.test(msg)) {
    return "general"
  }
  if (/what(?:'s| is) the (?:weather|temperature)/i.test(msg)) {
    return "general"
  }
  if (/best pizza recipe/i.test(msg)) {
    return "general"
  }
  if (/what (?:is the )?run status/i.test(msg)) {
    return "general"
  }
  if (/what extensions are available/i.test(msg)) {
    return "general"
  }
  if (/^what can you do\??$/i.test(msg)) {
    return "general"
  }
  if (/who are you|what are you/i.test(msg)) {
    return "general"
  }
  if (/\bfailed\b/i.test(msg) && /\b(echo|workflow|step)\b/i.test(msg)) {
    return "workflow-patch"
  }
  if (/\b(change|update|set|fix)\b/i.test(msg) && /\b(step|label|echo)\b/i.test(msg)) {
    return "workflow-patch"
  }
  if (isClearAllStepsRequest(msg)) {
    return "workflow-patch"
  }
  if (/\b(create|build|need)\b/i.test(msg) && /\bworkflow\b/i.test(msg)) {
    return "workflow-create"
  }
  if (/new workflow/i.test(msg)) {
    return "workflow-create"
  }
  return undefined
}

/** Whether a token is a valid classified intent value. @category Harness */
export function isClassifiedIntentValue(value: string): value is EcpIntentValue {
  return CLASSIFIED_INTENT_VALUE_SET.has(value)
}

/**
 * Normalize topic for trace/eval when the model emits a weak TOPIC token.
 * @category Harness
 */
export function canonicalizeIntentTopic(
  message: string,
  intent: EcpIntentValue,
  modelTopic?: string
): string {
  const fallback = deriveIntentTopicFallback(message, intent)
  if (!modelTopic) {
    return fallback
  }
  if (intent === "general" && /\b(joke|weather|recipe|resume|cover letter)\b/i.test(message)) {
    return "off-topic"
  }
  if (intent === "faq" && /patch/i.test(message) && !/patch/i.test(modelTopic)) {
    return "patching"
  }
  return modelTopic
}

/**
 * Derive a topic bucket when the model omits TOPIC in intent EQL.
 * @category Harness
 */
export function deriveIntentTopicFallback(message: string, intent: EcpIntentValue): string {
  const msg = message.trim()
  if (intent === "faq") {
    if (/patch/i.test(msg)) return "patching"
    if (/workflow/i.test(msg)) return "workflows"
    if (/ecp/i.test(msg)) return "ecp"
    return "ecp"
  }
  if (intent === "workflow-patch") {
    if (/\b(poem|generate)\b/i.test(msg)) return "generate-failure"
    if (/\bfail/i.test(msg)) return "workflow-failure"
    if (/\b(step|label|input)\b/i.test(msg)) return "step-change"
    return "workflow-patch"
  }
  if (intent === "workflow-create") {
    if (/\b(generate|chrome\s*ai|poem|haiku)\b/i.test(msg)) return "generate-workflow"
    return "workflow-create"
  }
  if (/\b(joke|weather|recipe|resume|cover letter)\b/i.test(msg)) {
    return "off-topic"
  }
  if (/^(hello|hi|bonjour|hola)\b/i.test(msg)) {
    return "greeting"
  }
  if (/\b(extension|capabilit|plugin)\b/i.test(msg)) {
    return "capabilities"
  }
  if (/what can you do/i.test(msg)) {
    return "assistant-identity"
  }
  return "general"
}

/**
 * Derive a one-line summary when the model omits SUMMARY in intent EQL.
 * @category Harness
 */
export function deriveIntentSummaryFallback(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ")
  if (trimmed.length <= SUMMARY_MAX_LENGTH) {
    return trimmed
  }
  return `${trimmed.slice(0, SUMMARY_MAX_LENGTH - 3)}...`
}

/**
 * Fill optional topic/summary on a classified intent document.
 * @category Harness
 */
export function enrichClassifiedIntent(intent: EcpIntent, message: string): EcpIntent {
  return {
    ...intent,
    topic: intent.topic ?? deriveIntentTopicFallback(message, intent.intent),
    summary: intent.summary ?? deriveIntentSummaryFallback(message),
  }
}

/**
 * Apply message-heuristic corrections after model intent decode (nano harness policy).
 * @category Harness
 */
export function correctClassifiedIntent(message: string, intent: EcpIntent): EcpIntent {
  const heuristic = inferIntentFromMessageHeuristic(message)
  let value = intent.intent

  if (heuristic !== undefined) {
    value = heuristic
  } else if (
    value === "workflow-create" &&
    (/^(hello|hi|bonjour|hola)\b/i.test(message.trim()) ||
      /^what is ecp\b/i.test(message.trim()) ||
      /tell me a joke/i.test(message) ||
      /what extensions are available/i.test(message) ||
      /^what can you do\??$/i.test(message.trim()) ||
      /who are you|what are you/i.test(message))
  ) {
    value = /^what is ecp\b/i.test(message.trim()) ? "faq" : "general"
  } else if (
    value === "workflow-patch" &&
    /^how\s+(?:does|do)\b/i.test(message.trim()) &&
    /\bwork\b/i.test(message)
  ) {
    value = "faq"
  } else if (value === "faq" && /what(?:'s| is) the weather/i.test(message)) {
    value = "general"
  }

  const topic = canonicalizeIntentTopic(message, value, intent.topic)
  return enrichClassifiedIntent({ ...intent, intent: value, topic }, message)
}

/**
 * Format classified intent block for contextualized shot user prompts.
 * @category Harness
 */
export function formatClassifiedIntentBlock(intent: EcpIntent): string[] {
  const lines = [`Classified intent: ${intent.intent}`]
  if (intent.topic) {
    lines.push(`Topic: ${intent.topic}`)
  }
  if (intent.summary) {
    lines.push(`Request summary: ${intent.summary}`)
  }
  return lines
}

/**
 * Deterministic routing hints for intent classification (unfiltered phase).
 * @category Harness
 */
export function formatIntentRoutingHintLines(message: string): string[] {
  const lines: string[] = []
  if (/^how\s+(?:does|do)\b/i.test(message.trim()) && /\bwork\b/i.test(message)) {
    lines.push(
      "Routing hint: how-does questions about ECP features → INTENT faq (not workflow-patch)."
    )
  }
  if (/^what is ecp\b/i.test(message.trim())) {
    lines.push("Routing hint: definitional questions about ECP → INTENT faq.")
  }
  if (/^(hello|hi|bonjour|hola)\b/i.test(message.trim())) {
    lines.push("Routing hint: greetings → INTENT general (not workflow-create).")
  }
  if (/tell me a joke/i.test(message)) {
    lines.push("Routing hint: off-topic chat → INTENT general.")
  }
  if (/what extensions are available/i.test(message)) {
    lines.push("Routing hint: capability inventory questions → INTENT general.")
  }
  if (/what (?:is the )?run status/i.test(message)) {
    lines.push("Routing hint: run status questions → INTENT general.")
  }
  if (/^what can you do\??$/i.test(message.trim())) {
    lines.push("Routing hint: assistant identity → INTENT general.")
  }
  if (
    /\b(update|change|set)\b/i.test(message) &&
    /\b(step|echo|summarize|validate|notify|translate)\b/i.test(message)
  ) {
    lines.push("Routing hint: changing an existing step → INTENT workflow-patch.")
  }
  if (isClearAllStepsRequest(message)) {
    lines.push(
      "Routing hint: clear / remove all / start fresh on an existing workflow → INTENT workflow-patch (keep workflow id; delete or rebuild steps)."
    )
  }
  if (/\bfailed\b/i.test(message) && /\b(step|workflow|echo)\b/i.test(message)) {
    lines.push("Routing hint: workflow failure symptom → INTENT workflow-patch.")
  }
  return lines
}
