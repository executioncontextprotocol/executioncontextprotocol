import { ECP_HARNESS_REPLY_SCHEMA, type HarnessReply, type HarnessRunContext, type EcpIntent, type WorkflowManifest, ECP_HARNESS_REPLY_ACTIONS } from "@executioncontrolprotocol/types"
import { isEnvironmentQuestion } from "./environment-question.js"
import type { CompactEnvironmentSummary } from "./summarize-environment.js"
import { summarizeHarnessRunContext } from "./summarize-run-context.js"
import { summarizeWorkflowManifest } from "./summarize-workflow.js"

/** Shared redirect phrase for safe-reply and out-of-scope assistant answers. @category Harness */
export const HARNESS_ASSISTANT_SCOPE_REDIRECT_PHRASE =
  "workflows, ECP, or available capabilities"

/** Default safe reply when assistant decode/repair fails. @category Harness */
export const HARNESS_ASSISTANT_SAFE_REPLY_MESSAGE =
  `I could not answer that cleanly — try rephrasing or ask about ${HARNESS_ASSISTANT_SCOPE_REDIRECT_PHRASE}.`

/** Model-facing default for off-topic, unknowable, or gibberish user messages. @category Harness */
export const HARNESS_ASSISTANT_OUT_OF_SCOPE_ANSWER =
  `I cannot help with that — ask about ${HARNESS_ASSISTANT_SCOPE_REDIRECT_PHRASE}.`

const HARNESS_SCOPE_REDIRECT_TOKENS = ["ecp", "workflow", "capabilit", "scope", "rephras"] as const

/**
 * True when the assistant answer redirects the user toward ECP harness scope.
 * @category Harness
 */
export function answerRedirectsToHarnessScope(answer: string): boolean {
  const lower = answer.toLowerCase()
  return HARNESS_SCOPE_REDIRECT_TOKENS.some((token) => lower.includes(token))
}

/**
 * Minimal valid harness reply for graceful assistant fallback.
 * @category Harness
 */
export function buildAssistantSafeReply(message?: string): HarnessReply {
  return {
    schema: ECP_HARNESS_REPLY_SCHEMA,
    answer: message ?? HARNESS_ASSISTANT_SAFE_REPLY_MESSAGE,
  }
}

function readStepError(runContext: HarnessRunContext, stepId: string): string | undefined {
  const record = runContext.run.history?.[stepId]
  if (!record?.output || typeof record.output !== "object") {
    return undefined
  }
  const output = record.output as { error?: unknown }
  if (typeof output.error === "string" && output.error.length > 0) {
    return output.error
  }
  return undefined
}

/**
 * Deterministic assistant reply from run context when the user question is unambiguous.
 * @category Harness
 */
export function tryBuildRunContextReply(
  message: string,
  runContext?: HarnessRunContext
): HarnessReply | undefined {
  if (!runContext) {
    return undefined
  }
  const summary = summarizeHarnessRunContext(runContext)
  const msg = message.trim()

  if (/what (?:is the )?run status/i.test(msg) || /\b(?:still\s+)?running\b/i.test(msg)) {
    return buildAssistantSafeReply(`The current run status is: ${summary.status}.`)
  }

  const failStepMatch = msg.match(/why did step (\w+) fail/i)
  if (failStepMatch || /what error occurred/i.test(msg)) {
    const stepId = failStepMatch?.[1] ?? summary.failedSteps[0]?.stepId
    if (!stepId) {
      return undefined
    }
    const error = readStepError(runContext, stepId)
    if (!error) {
      return undefined
    }
    return buildAssistantSafeReply(`Step ${stepId} failed with error: ${error}`)
  }

  const fixEchoMatch =
    /\bhow can i fix\b.*\becho\b/i.test(msg) || /\bfix\b.*\becho\b.*\berror\b/i.test(msg)
  if (fixEchoMatch) {
    const stepId = summary.failedSteps[0]?.stepId ?? "echo"
    const error = readStepError(runContext, stepId)
    if (!error) {
      return undefined
    }
    return {
      schema: ECP_HARNESS_REPLY_SCHEMA,
      answer: `Step ${stepId} failed with error: ${error}. Update the ${stepId} step input with a non-empty value to fix it.`,
      citations: [{ kind: "step", id: stepId }],
    }
  }

  if (
    /\b(?:explain|describe)\b.*\b(?:failure|error)\b/i.test(msg) ||
    /\b(?:failure|error)\b.*\bpolitely\b/i.test(msg)
  ) {
    const stepId = summary.failedSteps[0]?.stepId
    if (!stepId) {
      return undefined
    }
    const error = readStepError(runContext, stepId)
    if (!error) {
      return undefined
    }
    return {
      schema: ECP_HARNESS_REPLY_SCHEMA,
      answer: `The ${stepId} step failed with an error: ${error}. Updating the step input with a valid value should resolve it.`,
      citations: [{ kind: "step", id: stepId }],
    }
  }

  return undefined
}

const FAQ_PATCHING_ANSWER =
  "ECP workflow patching applies targeted changes to an existing workflow using a patch document—you describe what to update (such as a step label or input) and the runtime validates and applies it without replacing the whole workflow."

const FAQ_ECP_DEFINITION_ANSWER =
  "ECP (Execution Control Protocol) is the runtime spec for agentic systems: portable workflows run inside governed environments that bind tools, models, policies, and runtimes."

const OFF_TOPIC_MESSAGE_PATTERNS = [
  /\bweather\b/i,
  /\bjoke\b/i,
  /\bcover letter\b/i,
  /\bresume\b/i,
] as const

/**
 * Deterministic FAQ reply for common ECP how-it-works questions (avoids patch-like EQL in answers).
 * @category Harness
 */
export function tryBuildFaqReply(
  message: string,
  classifiedIntent?: EcpIntent
): HarnessReply | undefined {
  const msg = message.trim()
  const topic = classifiedIntent?.topic?.toLowerCase() ?? ""
  const isFaqPatch =
    classifiedIntent?.intent === "faq" &&
    (topic.includes("patch") ||
      /how does .*patch/i.test(msg) ||
      /how (?:do|does) (?:i |you )?patch/i.test(msg))

  if (isFaqPatch) {
    return buildAssistantSafeReply(FAQ_PATCHING_ANSWER)
  }

  if (
    /^what is ecp\??$/i.test(msg) ||
    (classifiedIntent?.intent === "faq" && topic.includes("ecp"))
  ) {
    return buildAssistantSafeReply(FAQ_ECP_DEFINITION_ANSWER)
  }

  return undefined
}

/**
 * Deterministic off-topic decline for common non-ECP requests.
 * @category Harness
 */
export function tryBuildOffTopicReply(message: string): HarnessReply | undefined {
  if (!OFF_TOPIC_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return undefined
  }
  return buildAssistantSafeReply(HARNESS_ASSISTANT_OUT_OF_SCOPE_ANSWER)
}

function formatExtensionList(summary: CompactEnvironmentSummary): string {
  const ids = summary.extensions.map((ext) => ext.id)
  if (ids.length <= 1) {
    return ids[0] ?? "none"
  }
  const last = ids[ids.length - 1]!
  return `${ids.slice(0, -1).join(", ")}, and ${last}`
}

function formatStepCapabilityList(summary: CompactEnvironmentSummary): string {
  const generateIds = summary.capabilities
    .filter((cap) => cap.id.endsWith(".generate"))
    .map((cap) => cap.id)
  const ids =
    generateIds.length > 0
      ? generateIds
      : summary.capabilities.map((cap) => cap.id)
  if (ids.length === 0) {
    return "@executioncontrolprotocol/chrome-ai.generate"
  }
  if (ids.length <= 1) {
    return ids[0]!
  }
  const last = ids[ids.length - 1]!
  return `${ids.slice(0, -1).join(", ")}, and ${last}`
}

/**
 * Deterministic environment inventory reply for extension and capability questions.
 * @category Harness
 */
export function tryBuildEnvironmentReply(
  message: string,
  summary?: CompactEnvironmentSummary
): HarnessReply | undefined {
  if (!summary || !isEnvironmentQuestion(message)) {
    return undefined
  }
  if (/\b(?:register|install)\b/i.test(message)) {
    return undefined
  }
  if (!/\b(extensions?|capabilities|plugins?)\b/i.test(message)) {
    return undefined
  }
  if (/^what can you do\??$/i.test(message.trim())) {
    return undefined
  }
  const extensions = formatExtensionList(summary)
  const capabilities = formatStepCapabilityList(summary)
  return buildAssistantSafeReply(
    `ECP extensions loaded in this environment include ${extensions}. Step capabilities include ${capabilities}.`
  )
}

/**
 * Deterministic refusal when the user asks to register or install extensions.
 * @category Harness
 */
export function tryBuildRegisterRefusalReply(message: string): HarnessReply | undefined {
  if (!/\b(?:register|install)\b/i.test(message) || !/\b(?:extensions?|plugins?)\b/i.test(message)) {
    return undefined
  }
  return buildAssistantSafeReply(
    "I cannot register or install extensions in this environment — I can only use capabilities that are already loaded. Ask about workflows, ECP, or available capabilities."
  )
}

function stepKey(step: { id: string; uses: string; label?: string }): string {
  return `${step.id}|${step.uses}|${step.label ?? ""}`
}

/**
 * Deterministic conversational summary after a successful create/patch, with offer-run.
 * Used as the last-shot fallback when the model fails to produce a change summary.
 * @category Harness
 */
export function tryBuildChangeSummaryReply(
  baseline: WorkflowManifest | undefined,
  authored: WorkflowManifest
): HarnessReply {
  const after = summarizeWorkflowManifest(authored)
  const before = baseline ? summarizeWorkflowManifest(baseline) : undefined

  let changeLine: string
  if (!before) {
    const stepList =
      after.steps.length === 0
        ? "no steps"
        : after.steps.map((s) => s.id).join(", ")
    changeLine = `I created workflow "${after.workflowLabel ?? after.workflowId}" with ${stepList}.`
  } else {
    const beforeIds = new Set(before.steps.map((s) => s.id))
    const afterIds = new Set(after.steps.map((s) => s.id))
    const added = after.steps.filter((s) => !beforeIds.has(s.id)).map((s) => s.id)
    const removed = before.steps.filter((s) => !afterIds.has(s.id)).map((s) => s.id)
    const beforeById = new Map(before.steps.map((s) => [s.id, s]))
    const labelChanges: string[] = []
    for (const step of after.steps) {
      const prev = beforeById.get(step.id)
      if (prev && stepKey(prev) !== stepKey(step) && prev.label !== step.label) {
        labelChanges.push(`${step.id} → "${step.label ?? step.id}"`)
      }
    }
    const parts: string[] = []
    if (added.length > 0) parts.push(`added ${added.join(", ")}`)
    if (removed.length > 0) parts.push(`removed ${removed.join(", ")}`)
    if (labelChanges.length > 0) parts.push(`updated labels (${labelChanges.join("; ")})`)
    if (
      before.workflowLabel !== after.workflowLabel &&
      after.workflowLabel !== undefined
    ) {
      parts.push(`renamed workflow to "${after.workflowLabel}"`)
    }
    const acceptsChanged =
      before.accepts.join(",") !== after.accepts.join(",") ||
      before.returns.join(",") !== after.returns.join(",")
    if (acceptsChanged) parts.push("updated workflow inputs/outputs")

    changeLine =
      parts.length > 0
        ? `I updated the workflow: ${parts.join("; ")}.`
        : "I updated the workflow as requested."
  }

  return {
    schema: ECP_HARNESS_REPLY_SCHEMA,
    answer: `${changeLine} Want me to run it?`,
    suggestedAction: ECP_HARNESS_REPLY_ACTIONS.OFFER_RUN,
  }
}

/**
 * Conversational fallback when authoring fails — never offers run.
 * @category Harness
 */
export function buildAuthoringFailureReply(detail?: string): HarnessReply {
  const base =
    detail && detail.trim().length > 0
      ? `I could not update the workflow: ${detail.trim()}. Try rephrasing the change.`
      : "I could not update the workflow cleanly — try rephrasing the change."
  return buildAssistantSafeReply(base)
}
