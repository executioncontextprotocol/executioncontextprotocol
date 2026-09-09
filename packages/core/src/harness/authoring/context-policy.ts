import type { Ecp } from "../../environment/ecp.js"
import type {
  EcpIntentValue,
  HarnessPromptPhase,
  HarnessRunContext,
  ProbeContext,
  WorkflowManifest,
} from "@executioncontrolprotocol/types"
import { encodeForPrompt } from "./encode-prompt-text.js"
import { isEnvironmentQuestion } from "./environment-question.js"
import {
  formatEnvironmentSummaryLines,
  summarizeEnvironmentDescriptor,
  toAuthoringEnvironmentDescriptor,
  type CompactEnvironmentSummary,
  type EnvironmentSummaryFormat,
} from "./summarize-environment.js"
import { summarizeProbeContext } from "./summarize-probe-context.js"
import { formatRunContextSummaryLines } from "./summarize-run-context.js"
import { formatWorkflowSummaryLines } from "./summarize-workflow.js"

/** Character budget caps for user prompt context blocks. @category Harness */
export const CONTEXT_PROMPT_BUDGET = {
  unfiltered: 2000,
  contextualized: 6000,
} as const

/** Options for {@link buildContextBundle}. @category Harness */
export interface ContextBundleOptions {
  /** Prompt assembly phase. */
  phase: HarnessPromptPhase
  /** User message (for environment-question heuristics). */
  message: string
  /** Classified intent for contextualized bundle selection. */
  intent?: EcpIntentValue
  /** Baseline workflow manifest when patch or workflow summary is needed. */
  manifest?: WorkflowManifest
  /** Run context for assistant-style bundles. */
  runContext?: HarnessRunContext
  /** Live probe options for clarify / complete turns. */
  probeContext?: ProbeContext
  /** Rolling conversation summary from the caller. */
  conversationSummary?: string
  /** Include environment descriptor block. */
  includeEnvironmentDescriptor?: boolean
  /** Include encoded descriptor (TOON/EQL). */
  includeEncodedDescriptor?: boolean
  /** Formatter for encoded descriptor. */
  descriptorFormat?: string
  /** Render environment lines as EQL snippets when true. */
  outputIsEql?: boolean
  /** Patch mode for workflow summary and env format. */
  isPatch?: boolean
  /** Capability ids already used in baseline workflow (patch env trimming). */
  existingCapabilityUses?: Set<string>
}

/** Assembled context lines for harness user prompts. @category Harness */
export interface ContextBundle {
  /** Lines to prepend before the user message (excluding routing hints). */
  lines: string[]
}

function trimLinesToBudget(lines: string[], budget: number): string[] {
  const joined = lines.join("\n")
  if (joined.length <= budget) {
    return lines
  }
  const trimmed: string[] = []
  let used = 0
  for (const line of lines) {
    const next = used + line.length + (trimmed.length > 0 ? 1 : 0)
    if (next > budget) {
      break
    }
    trimmed.push(line)
    used = next
  }
  return trimmed
}

function envFormatForIntent(
  intent: EcpIntentValue | undefined,
  outputIsEql: boolean,
  isPatch: boolean
): EnvironmentSummaryFormat {
  if (!outputIsEql) {
    return "plain"
  }
  if (intent === "workflow-create" || intent === "workflow-probe") {
    return "eql-create"
  }
  if (intent === "workflow-patch" || intent === "workflow-clarify" || isPatch) {
    return "eql-patch"
  }
  return "plain"
}

function shouldIncludeEncodedDescriptor(
  options: ContextBundleOptions,
  envQuestion: boolean
): boolean {
  if (options.phase === "unfiltered") {
    return false
  }
  if (options.includeEncodedDescriptor) {
    return true
  }
  if (envQuestion && (options.intent === "faq" || options.intent === "general")) {
    return true
  }
  return false
}

function shouldIncludeEnvironment(
  options: ContextBundleOptions,
  envQuestion: boolean
): boolean {
  if (options.phase === "unfiltered") {
    return false
  }
  if (options.includeEnvironmentDescriptor === false) {
    return false
  }
  if (options.includeEnvironmentDescriptor === true) {
    return true
  }
  return (
    options.intent === "workflow-create" ||
    options.intent === "workflow-patch" ||
    options.intent === "workflow-probe" ||
    options.intent === "workflow-clarify" ||
    options.intent === "faq" ||
    options.intent === "general" ||
    envQuestion
  )
}

function shouldIncludeRunContext(options: ContextBundleOptions): boolean {
  if (options.phase === "unfiltered" || !options.runContext) {
    return false
  }
  return (
    options.intent === "workflow-patch" ||
    options.intent === "workflow-clarify" ||
    options.intent === "faq" ||
    options.intent === "general"
  )
}

function shouldIncludeWorkflowSummary(options: ContextBundleOptions): boolean {
  if (options.phase === "unfiltered" || !options.manifest) {
    return false
  }
  return (
    options.intent === "workflow-patch" ||
    options.intent === "workflow-probe" ||
    options.intent === "workflow-clarify" ||
    options.intent === "faq" ||
    options.intent === "general"
  )
}

function shouldIncludeProbeContext(options: ContextBundleOptions): boolean {
  if (options.phase === "unfiltered" || !options.probeContext) {
    return false
  }
  return (
    options.intent === "workflow-clarify" ||
    options.intent === "workflow-patch" ||
    options.intent === "faq" ||
    options.intent === "general"
  )
}

/**
 * Build context lines for a harness prompt phase and classified intent.
 * @category Harness
 */
export async function buildContextBundle(
  ecp: Ecp,
  options: ContextBundleOptions
): Promise<ContextBundle> {
  const lines: string[] = []
  const budget = CONTEXT_PROMPT_BUDGET[options.phase]
  const envQuestion = isEnvironmentQuestion(options.message)
  const outputIsEql = options.outputIsEql ?? false

  if (options.conversationSummary?.trim() && options.phase === "contextualized") {
    lines.push("Conversation summary:", options.conversationSummary.trim(), "")
  }

  let environmentSummary: CompactEnvironmentSummary | undefined
  let environmentDescriptor: Awaited<ReturnType<Ecp["describe"]>> | undefined
  if (shouldIncludeEnvironment(options, envQuestion)) {
    environmentDescriptor = await ecp.describe()
    environmentSummary = summarizeEnvironmentDescriptor(environmentDescriptor)
    const envLines = formatEnvironmentSummaryLines(environmentSummary, {
      format: envFormatForIntent(options.intent, outputIsEql, options.isPatch ?? false),
      existingCapabilityUses: options.existingCapabilityUses,
    })
    if (envLines.length > 0) {
      lines.push("Environment capabilities:", ...envLines, "")
    }

    if (
      shouldIncludeEncodedDescriptor(options, envQuestion) &&
      environmentDescriptor !== undefined
    ) {
      const descriptorFormat =
        options.descriptorFormat ?? "@executioncontrolprotocol/format-eql"
      const descriptorText = await encodeForPrompt(
        ecp,
        toAuthoringEnvironmentDescriptor(environmentDescriptor),
        descriptorFormat
      )
      if (descriptorText) {
        lines.push("Environment capabilities (encoded):", descriptorText, "")
      }
    }
  }

  if (shouldIncludeWorkflowSummary(options) && options.manifest) {
    const workflowLines = formatWorkflowSummaryLines(options.manifest, {
      eql: outputIsEql,
      patchContext: options.intent === "workflow-patch",
    })
    if (workflowLines.length > 0) {
      lines.push("Workflow (summary):", ...workflowLines, "")
    }
  }

  if (shouldIncludeRunContext(options) && options.runContext) {
    const runLines = formatRunContextSummaryLines(options.runContext)
    if (runLines.length > 0) {
      lines.push("Run context (summary):", ...runLines, "")
    }
  }

  if (shouldIncludeProbeContext(options) && options.probeContext) {
    const probeLines = summarizeProbeContext(options.probeContext)
    if (probeLines.length > 0) {
      lines.push("Probe context:", ...probeLines, "")
    }
  }

  return { lines: trimLinesToBudget(lines, budget) }
}
