import {
  buildAssistantSafeReply,
  tryBuildRunContextReply,
  tryBuildFaqReply,
  tryBuildEnvironmentReply,
  tryBuildRegisterRefusalReply,
  tryBuildOffTopicReply,
  callModelGenerate,
  collectDecodeFeedback,
  collectModelOutputFeedback,
  collectValidationFeedback,
  defineHarness,
  type HarnessCapabilityContext,
  inferResponseFormatFromFormatter,
  isEnvironmentQuestion,
  isRepairFeedbackEcho,
  runModelRepairLoop,
  stripMarkdownCodeFences,
  buildContextBundle,
  formatClassifiedIntentBlock,
  formatFeedbackForModel,
  formatModelRepairDialogLines,
  summarizeEnvironmentDescriptor,
  type CompactEnvironmentSummary,
} from "@executioncontrolprotocol/core"
import {
  ECP_CORE_FORMATTER_IDS,
  ECP_HARNESS_REPLY_SCHEMA,
  ECP_MODEL_GENERATE_INTERFACE,
  ecpIntentSchema,
  harnessEvaluateOutputSchema,
  harnessRunContextSchema,
  LATEST_ECP_VERSION,
  type EcpIntent,
  type HarnessEvaluateOutput,
  type HarnessInvokeResult,
  type HarnessOperationFeedback,
  type HarnessPromptPhase,
  type HarnessReply,
  type HarnessRunContext,
  type ValidationResult,
  type WorkflowManifest,
} from "@executioncontrolprotocol/types"
import { z } from "zod"
import { BROWSER_NANO_HARNESS_ID } from "./harness-ids.js"
import { buildNanoRepairHint, buildNanoSystemPrompt } from "./prompts/index.js"

const harnessConfigSchema = z.object({
  promptFixture: z.string().default("workflow-assistant"),
  system: z.string().optional(),
  context: z
    .object({
      promptPhase: z.enum(["unfiltered", "contextualized"]).default("contextualized"),
      includeEnvironmentDescriptor: z.boolean().default(true),
      includeEncodedDescriptor: z.boolean().default(false),
      descriptorFormat: z.string().default("@executioncontrolprotocol/format-eql"),
      includeRunContext: z.boolean().default(true),
      runContextFormat: z.string().default(ECP_CORE_FORMATTER_IDS.JSON),
    })
    .default({}),
  output: z
    .object({
      schema: z.string().default(ECP_HARNESS_REPLY_SCHEMA),
      format: z.string().default("@executioncontrolprotocol/format-eql"),
      validate: z.boolean().default(true),
    })
    .default({}),
  repair: z
    .object({
      enabled: z.boolean().default(true),
      maxAttempts: z.number().default(1),
      includeValidationErrors: z.boolean().default(true),
      safeReplyFallback: z.boolean().default(true),
      includePriorOutput: z.boolean().default(false),
      priorOutputMaxChars: z.number().optional(),
    })
    .default({}),
  trace: z
    .object({
      includePrompt: z.boolean().default(false),
      includeRawOutput: z.boolean().default(true),
      includeValidation: z.boolean().default(true),
      includeRepairAttempts: z.boolean().default(true),
    })
    .default({}),
})

const harnessInputSchema = z.object({
  message: z.string(),
  model: z.string().optional(),
  runContext: harnessRunContextSchema.optional(),
  workflow: z.record(z.string(), z.unknown()).optional(),
  classifiedIntent: ecpIntentSchema.optional(),
  conversationSummary: z.string().optional(),
})

function formatReplyAsEql(reply: HarnessReply): string {
  const lines = ["REPLY", `  ANSWER "${reply.answer.replace(/"/g, '\\"')}"`]
  for (const c of reply.citations ?? []) {
    const idPart = c.id ? ` ${c.id}` : ""
    const detailPart = c.detail ? ` "${c.detail.replace(/"/g, '\\"')}"` : ""
    lines.push(`  CITATION ${c.kind}${idPart}${detailPart}`)
  }
  if (reply.suggestedAction) {
    lines.push(`  ACTION ${reply.suggestedAction}`)
  }
  return lines.join("\n")
}

/**
 * Unified ECP assistant harness (workflow Q&A, FAQ, environment help).
 * @category Harness
 */
export const evalsWorkflowAssistantHarness = defineHarness("@executioncontrolprotocol", "evals-workflow-assistant")
  .withConfig(harnessConfigSchema)
  .withInput(harnessInputSchema)
  .withOutput(harnessEvaluateOutputSchema)
  .usesProviderInterface(ECP_MODEL_GENERATE_INTERFACE)
  .withHandler(async (input, ctx) => {
    const config = ctx.config
    const format = config.output.format
    const outputIsEql = format === "@executioncontrolprotocol/format-eql" || format.endsWith("/format-eql")
    const descriptorFormat = config.context.descriptorFormat ?? format
    const promptFixtureId = config.promptFixture
    const promptPhase = config.context.promptPhase as HarnessPromptPhase
    const system = config.system ?? buildNanoSystemPrompt(promptFixtureId)
    const envQuestion = isEnvironmentQuestion(input.message)
    const workflowManifest = input.workflow as unknown as WorkflowManifest | undefined

    const capabilitiesQuestion =
      isEnvironmentQuestion(input.message) &&
      /\b(capabilit|extensions?|plugins?)\b/i.test(input.message) &&
      !/^what can you do\??$/i.test(input.message.trim())

    let environmentSummary: CompactEnvironmentSummary | undefined
    if (capabilitiesQuestion && ctx.ecp) {
      environmentSummary = summarizeEnvironmentDescriptor(await ctx.ecp.describe())
    }

    const contextBundle = await buildContextBundle(ctx.ecp, {
      phase: promptPhase,
      message: input.message,
      intent: input.classifiedIntent?.intent,
      manifest: workflowManifest,
      runContext:
        config.context.includeRunContext && input.runContext
          ? (input.runContext as HarnessRunContext)
          : undefined,
      conversationSummary: input.conversationSummary,
      includeEnvironmentDescriptor: config.context.includeEnvironmentDescriptor,
      includeEncodedDescriptor:
        config.context.includeEncodedDescriptor || envQuestion,
      descriptorFormat,
      outputIsEql,
    })

    const buildPrompt = (repairDialogLines: string[] = []) => {
      const lines: string[] = []
      if (input.classifiedIntent) {
        lines.push(...formatClassifiedIntentBlock(input.classifiedIntent), "")
      }
      const capabilitiesQuestion =
        isEnvironmentQuestion(input.message) &&
        /\b(capabilit|extensions?|plugins?)\b/i.test(input.message) &&
        !/^what can you do\??$/i.test(input.message.trim())
      if (capabilitiesQuestion) {
        lines.push(
          "Required reply: mention ECP and list step capability ids from the environment summary (must include @executioncontrolprotocol/chrome-ai.generate or a *.generate capability)."
        )
      }
      lines.push(...contextBundle.lines)
      if (
        input.runContext &&
        /what (?:is the )?run status/i.test(input.message)
      ) {
        lines.push(
          "Required reply: state the run status from the Run context lines above (e.g. failed, running, completed)."
        )
      }
      lines.push(`User message: ${input.message}`)
      if (repairDialogLines.length > 0) {
        lines.push(...repairDialogLines)
      }
      return lines.join("\n")
    }

    const maxAttempts = config.repair.enabled ? 1 + config.repair.maxAttempts : 1
    let lastPrompt = buildPrompt()
    let validation = decodedValidationStub()
    let lastRaw = ""

    const deterministicReply =
      tryBuildRunContextReply(
        input.message,
        config.context.includeRunContext && input.runContext
          ? (input.runContext as HarnessRunContext)
          : undefined
      ) ??
      tryBuildFaqReply(input.message, input.classifiedIntent) ??
      tryBuildRegisterRefusalReply(input.message) ??
      tryBuildOffTopicReply(input.message) ??
      tryBuildEnvironmentReply(input.message, environmentSummary)
    if (deterministicReply) {
      const deterministicRaw = formatReplyAsEql(deterministicReply)
      const trace: HarnessInvokeResult["trace"] = {
        harness: BROWSER_NANO_HARNESS_ID,
        provider: ctx.uses,
        model: input.model,
        outputSchema: config.output.schema,
        outputFormat: format,
        decodeSucceeded: true,
        validationSucceeded: true,
        promptPhase,
        ...(config.trace.includePrompt ? { prompt: "[deterministic run-context reply]" } : {}),
        ...(config.trace.includeRawOutput ? { rawOutput: deterministicRaw } : {}),
      }
      return {
        artifact: deterministicReply,
        raw: deterministicRaw,
        ...(config.trace.includeValidation ? { validation: decodedValidationStub(true) } : {}),
        trace,
      }
    }

    try {
      const loopResult = await runModelRepairLoop({
        maxAttempts,
        generate: async ({ attempt, priorFeedback, priorRaw }) => {
          const repairFeedback =
            attempt > 0 && config.repair.includeValidationErrors
              ? formatFeedbackForModel(priorFeedback)
              : undefined
          const outputLabel = outputIsEql ? "EQL" : "JSON"
          const repairDialogLines =
            attempt > 0 && repairFeedback
              ? formatModelRepairDialogLines({
                  includePriorOutput: config.repair.includePriorOutput,
                  priorOutputMaxChars: config.repair.priorOutputMaxChars,
                  priorRaw,
                  repairFeedback,
                  repairHint: buildNanoRepairHint(promptFixtureId),
                  repairLead: `Previous attempt failed. Fix these issues and return corrected ${outputLabel} only:`,
                })
              : []
          lastPrompt = buildPrompt(repairDialogLines)
          const generated = await callModelGenerate(
            ctx.uses,
            {
              prompt: lastPrompt,
              system,
              model: input.model,
              responseFormat: inferResponseFormatFromFormatter(format),
            },
            ctx.capabilityContext,
            format
          )
          lastRaw = stripMarkdownCodeFences(generated.text)
          return { raw: lastRaw }
        },
        evaluate: async (raw, { attempt, priorFeedback }) => {
          const feedback: HarnessOperationFeedback[] = []

          if (
            attempt > 0 &&
            config.repair.includeValidationErrors &&
            isRepairFeedbackEcho(raw, formatFeedbackForModel(priorFeedback))
          ) {
            return {
              success: false,
              feedback: [
                collectModelOutputFeedback(
                  "Output echoed validation errors instead of a document. Return only a valid harness reply."
                ),
              ],
            }
          }

          const decoded = await ctx.ecp
            .decode(raw)
            .uses(format)
            .to(ECP_HARNESS_REPLY_SCHEMA)
            .with({ headers: false })
            .process()

          validation = decoded.validation ?? decodedValidationStub(!decoded.success)

          feedback.push(collectDecodeFeedback(decoded))

          if (!decoded.success || !decoded.result) {
            return { success: false, feedback }
          }

          if (config.output.validate && validation.valid === false) {
            feedback.push(collectValidationFeedback(validation))
            return { success: false, feedback }
          }

          return { success: true, artifact: decoded.result, feedback }
        },
      })

      const trace: HarnessInvokeResult["trace"] = {
        harness: BROWSER_NANO_HARNESS_ID,
        provider: ctx.uses,
        model: input.model,
        outputSchema: config.output.schema,
        outputFormat: format,
        decodeSucceeded: true,
        validationSucceeded: validation.valid,
        promptPhase,
        ...(config.trace.includePrompt ? { prompt: lastPrompt } : {}),
        ...(config.trace.includeRawOutput ? { rawOutput: loopResult.raw } : {}),
        ...(config.trace.includeRepairAttempts ? { repairAttempts: loopResult.attempts } : {}),
      }

      return {
        artifact: loopResult.artifact,
        raw: loopResult.raw,
        ...(config.trace.includeValidation ? { validation } : {}),
        trace,
      }
    } catch (err) {
      if (!config.repair.safeReplyFallback) {
        throw err
      }
      const fallbackReply = buildAssistantSafeReply()
      const safeRaw = formatReplyAsEql(fallbackReply)
      const trace: HarnessInvokeResult["trace"] = {
        harness: BROWSER_NANO_HARNESS_ID,
        provider: ctx.uses,
        model: input.model,
        outputSchema: config.output.schema,
        outputFormat: format,
        decodeSucceeded: false,
        validationSucceeded: false,
        ...(config.trace.includePrompt ? { prompt: lastPrompt } : {}),
        ...(config.trace.includeRawOutput ? { rawOutput: lastRaw || safeRaw } : {}),
      }
      return {
        artifact: fallbackReply,
        raw: lastRaw || safeRaw,
        validation: decodedValidationStub(false),
        trace,
      }
    }
  })
  .build()

function decodedValidationStub(valid = true): ValidationResult {
  return {
    schema: "@executioncontrolprotocol.validation.result",
    version: LATEST_ECP_VERSION,
    valid,
    errors: [],
    warnings: [],
  }
}

/** Assistant task handler (invoked by `@executioncontrolprotocol/harness-browser-nano`). @category Harness */
export async function invokeWorkflowAssistant(
  input: {
    message: string
    runContext?: unknown
    workflow?: Record<string, unknown>
    model?: string
    classifiedIntent?: EcpIntent
    conversationSummary?: string
  },
  ctx: HarnessCapabilityContext<Record<string, unknown>>
): Promise<HarnessEvaluateOutput> {
  return evalsWorkflowAssistantHarness.handler(input, ctx) as Promise<HarnessEvaluateOutput>
}

/** @deprecated Use {@link invokeWorkflowAssistant} */
export const invokeEvalWorkflowAssistant = invokeWorkflowAssistant
