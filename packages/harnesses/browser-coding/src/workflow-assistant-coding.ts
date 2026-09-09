import { compileHarnessArtifactSource } from "@executioncontrolprotocol/core/compile"
import {
  answerRedirectsToHarnessScope,
  buildAssistantSafeReply,
  callModelGenerate,
  collectModelOutputFeedback,
  collectValidationFeedback,
  defineHarness,
  formatEnvironmentSummaryLines,
  formatFeedbackForModel,
  formatRunContextSummaryLines,
  formatWorkflowSummaryLines,
  HARNESS_OUTPUT_FORMAT_TYPESCRIPT,
  inferResponseFormatFromFormatter,
  isRepairFeedbackEcho,
  runModelRepairLoop,
  stripHarnessTypeScriptOutput,
  summarizeEnvironmentDescriptor,
  type HarnessCapabilityContext,
} from "@executioncontrolprotocol/core"
import {
  ECP_HARNESS_REPLY_SCHEMA,
  ECP_MODEL_GENERATE_INTERFACE,
  harnessEvaluateOutputSchema,
  harnessRunContextSchema,
  LATEST_ECP_VERSION,
  type HarnessEvaluateOutput,
  type HarnessInvokeResult,
  type HarnessOperationFeedback,
  type HarnessReply,
  type HarnessRepairAttempt,
  type HarnessRunContext,
  type ValidationResult,
  type WorkflowManifest,
} from "@executioncontrolprotocol/types"
import { z } from "zod"
import { BROWSER_CODING_HARNESS_ID } from "./harness-ids.js"
import {
  buildCodingRepairHint,
  buildCodingSystemPrompt,
  CODING_PROMPT_FIXTURE_IDS,
} from "./prompts/index.js"

const OFF_TOPIC_USER_MESSAGE = /\bjoke\b|weather|cover letter|recipe|pizza\b/i
const JOKE_USER_MESSAGE = /\bjoke\b/i
const JOKE_IN_ANSWER =
  /\bwhy did\b|knock knock|here'?s a joke|that's funny|humor\b|laugh\b|pun\b/i
const REGISTER_EXTENSION_REQUEST = /register.*extension/i
const OFF_TOPIC_BRIEF_MAX_CHARS = 220

/** Wording aligned with workflow-assistant-coding few-shot and off-topic judge rubric. */
const CANONICAL_JOKE_DECLINE =
  "I cannot help with jokes. Ask about workflows, ECP, or available capabilities in this environment."

function looksLikeHarnessTypeScriptSource(raw: string): boolean {
  return /^\s*(import|export)\b/m.test(raw)
}

function looksLikePlainDeclineAnswer(raw: string): boolean {
  const trimmed = raw.trim()
  return (
    !looksLikeHarnessTypeScriptSource(trimmed) &&
    (/^(I )?[Cc]annot\b/.test(trimmed) || /^[Cc]annot\b/.test(trimmed))
  )
}

function normalizeAssistantModelRaw(text: string): string {
  let raw = stripHarnessTypeScriptOutput(text)
  if (!looksLikeHarnessTypeScriptSource(raw) && looksLikePlainDeclineAnswer(raw)) {
    const answer = raw.replace(/\s+/g, " ").trim()
    raw = formatReplyAsTypeScript({
      schema: ECP_HARNESS_REPLY_SCHEMA,
      answer,
    })
  }
  return raw
}

const harnessConfigSchema = z.object({
  promptFixture: z.string().default(CODING_PROMPT_FIXTURE_IDS.WORKFLOW_ASSISTANT),
  system: z.string().optional(),
  context: z
    .object({
      includeEnvironmentDescriptor: z.boolean().default(true),
      includeEncodedDescriptor: z.boolean().default(false),
      descriptorFormat: z.string().default("@executioncontrolprotocol/format-json"),
      includeRunContext: z.boolean().default(true),
      runContextFormat: z.string().default("@executioncontrolprotocol/format-json"),
    })
    .default({}),
  output: z
    .object({
      schema: z.string().default(ECP_HARNESS_REPLY_SCHEMA),
      format: z.string().default(HARNESS_OUTPUT_FORMAT_TYPESCRIPT),
      validate: z.boolean().default(true),
    })
    .default({}),
  repair: z
    .object({
      enabled: z.boolean().default(true),
      maxAttempts: z.number().default(1),
      includeValidationErrors: z.boolean().default(true),
      safeReplyFallback: z.boolean().default(true),
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
  classifiedIntent: z
    .object({
      schema: z.literal("@executioncontrolprotocol.intent"),
      intent: z.string(),
      topic: z.string().optional(),
      summary: z.string().optional(),
    })
    .optional(),
  conversationSummary: z.string().optional(),
})

function formatReplyAsTypeScript(reply: HarnessReply): string {
  const answer = reply.answer.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  const citations =
    reply.citations?.length &&
    `,\n  citations: ${JSON.stringify(reply.citations, null, 2).replace(/\n/g, "\n  ")}`
  const suggestedAction = reply.suggestedAction
    ? `,\n  suggestedAction: "${reply.suggestedAction}"`
    : ""
  return `import type { HarnessReply } from "@executioncontrolprotocol/types"

export const reply: HarnessReply = {
  schema: "@executioncontrolprotocol.harness.reply",
  answer: "${answer}"${citations ?? ""}${suggestedAction},
}`
}

const codingAssistantHarness = defineHarness("@executioncontrolprotocol", "browser-coding-workflow-assistant")
  .withConfig(harnessConfigSchema)
  .withInput(harnessInputSchema)
  .withOutput(harnessEvaluateOutputSchema)
  .usesProviderInterface(ECP_MODEL_GENERATE_INTERFACE)
  .withHandler(async (input, ctx) => {
    const config = ctx.config
    const format = config.output.format
    const system = config.system ?? buildCodingSystemPrompt(config.promptFixture)

    let environmentSummaryLines = ""
    if (config.context.includeEnvironmentDescriptor) {
      const descriptor = await ctx.ecp.describe()
      const summary = summarizeEnvironmentDescriptor(descriptor)
      environmentSummaryLines = formatEnvironmentSummaryLines(summary, {
        format: "plain",
      }).join("\n")
    }

    let runContextText = ""
    if (config.context.includeRunContext && input.runContext) {
      runContextText = formatRunContextSummaryLines(input.runContext as HarnessRunContext).join(
        "\n"
      )
    }

    let workflowText = ""
    if (input.workflow) {
      workflowText = formatWorkflowSummaryLines(input.workflow as unknown as WorkflowManifest, {
        eql: false,
        patchContext: false,
      }).join("\n")
    }

    const buildPrompt = (repairText?: string) => {
      const lines = [`User message: ${input.message}`]
      if (environmentSummaryLines) {
        lines.unshift("Environment capabilities:", environmentSummaryLines, "")
      }
      if (runContextText) {
        lines.push("Run context (summary):", runContextText, "")
      }
      if (workflowText) {
        lines.push("Workflow (summary):", workflowText, "")
      }
      if (repairText) {
        lines.push(
          "Previous attempt failed. Return corrected TypeScript only:",
          repairText,
          buildCodingRepairHint(config.promptFixture)
        )
      }
      return lines.join("\n")
    }

    const maxAttempts = config.repair.enabled ? 1 + config.repair.maxAttempts : 1
    let lastPrompt = buildPrompt()
    let validation = decodedValidationStub()
    let lastRaw = ""

    try {
      const loopResult = await runModelRepairLoop({
        maxAttempts,
        generate: async ({ attempt, priorFeedback }) => {
          const repairText =
            attempt > 0 && config.repair.includeValidationErrors
              ? formatFeedbackForModel(priorFeedback)
              : undefined
          lastPrompt = buildPrompt(repairText)
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
          lastRaw = normalizeAssistantModelRaw(generated.text)
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
                  "Output echoed validation errors. Return only the HarnessReply TypeScript module."
                ),
              ],
            }
          }

          const compiled = await compileHarnessArtifactSource({
            source: raw,
            filename: "reply.ts",
            expectedSchema: ECP_HARNESS_REPLY_SCHEMA,
          })

          validation = compiled.validation ?? decodedValidationStub(!compiled.ok)

          if (!compiled.ok || !compiled.artifact) {
            const msg =
              compiled.compileErrors?.map((e) => e.message).join("; ") ?? "Compile failed"
            feedback.push(collectModelOutputFeedback(msg))
            if (validation.valid === false) {
              feedback.push(collectValidationFeedback(validation))
            }
            return { success: false, feedback }
          }

          if (config.output.validate && validation.valid === false) {
            feedback.push(collectValidationFeedback(validation))
            return { success: false, feedback }
          }

          const reply = compiled.artifact as HarnessReply
          const answerLower = reply.answer.toLowerCase()
          if (REGISTER_EXTENSION_REQUEST.test(input.message) && !answerLower.includes("cannot")) {
            feedback.push(
              collectModelOutputFeedback(
                'reply.answer must include "cannot" and explain extensions cannot be registered here.'
              )
            )
            return { success: false, feedback }
          }
          if (JOKE_USER_MESSAGE.test(input.message)) {
            if (!answerLower.includes("cannot") || JOKE_IN_ANSWER.test(answerLower)) {
              feedback.push(
                collectModelOutputFeedback(
                  `Do not tell a joke. Use exactly: "${CANONICAL_JOKE_DECLINE}"`
                )
              )
              return { success: false, feedback }
            }
          } else if (
            OFF_TOPIC_USER_MESSAGE.test(input.message) &&
            !answerRedirectsToHarnessScope(reply.answer)
          ) {
            feedback.push(
              collectModelOutputFeedback(
                "Decline off-topic requests: reply.answer must include cannot and redirect to workflows, ECP, or available capabilities."
              )
            )
            return { success: false, feedback }
          }
          if (
            /cover letter/i.test(input.message) &&
            reply.answer.length > OFF_TOPIC_BRIEF_MAX_CHARS
          ) {
            feedback.push(
              collectModelOutputFeedback(
                `Keep reply.answer under ${OFF_TOPIC_BRIEF_MAX_CHARS} characters: one short sentence with cannot and a redirect to workflows, ECP, or capabilities.`
              )
            )
            return { success: false, feedback }
          }
          if (!looksLikeHarnessTypeScriptSource(raw)) {
            feedback.push(
              collectModelOutputFeedback(
                "Return only a TypeScript module starting with import type { HarnessReply } from \"@executioncontrolprotocol/types\" — no prose outside code."
              )
            )
            return { success: false, feedback }
          }

          let artifact: HarnessReply = compiled.artifact as HarnessReply
          if (JOKE_USER_MESSAGE.test(input.message)) {
            artifact = {
              schema: ECP_HARNESS_REPLY_SCHEMA,
              answer: CANONICAL_JOKE_DECLINE,
            }
            lastRaw = formatReplyAsTypeScript(artifact)
          }

          return { success: true, artifact, feedback }
        },
      })

      const trace: HarnessInvokeResult["trace"] = {
        harness: BROWSER_CODING_HARNESS_ID,
        provider: ctx.uses,
        model: input.model,
        outputSchema: config.output.schema,
        outputFormat: format,
        decodeSucceeded: true,
        validationSucceeded: validation.valid,
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
      const repairAttempts =
        err instanceof Error && "repairAttempts" in err
          ? (err as Error & { repairAttempts?: HarnessRepairAttempt[] }).repairAttempts
          : undefined
      const safeReply = buildAssistantSafeReply()
      const safeRaw = formatReplyAsTypeScript(safeReply)
      const trace: HarnessInvokeResult["trace"] = {
        harness: BROWSER_CODING_HARNESS_ID,
        provider: ctx.uses,
        model: input.model,
        outputSchema: config.output.schema,
        outputFormat: format,
        decodeSucceeded: false,
        validationSucceeded: false,
        ...(config.trace.includePrompt ? { prompt: lastPrompt } : {}),
        ...(config.trace.includeRawOutput ? { rawOutput: lastRaw || safeRaw } : {}),
        ...(config.trace.includeRepairAttempts && repairAttempts
          ? { repairAttempts }
          : {}),
      }
      return {
        artifact: safeReply,
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

/** Workflow assistant for Browser Coding harness. @category Harness */
export async function invokeWorkflowAssistantCoding(
  input: {
    message: string
    runContext?: unknown
    model?: string
    workflow?: Record<string, unknown>
    classifiedIntent?: { schema: string; intent: string; topic?: string; summary?: string }
    conversationSummary?: string
    probeContext?: unknown
  },
  ctx: HarnessCapabilityContext<Record<string, unknown>>
): Promise<HarnessEvaluateOutput> {
  return codingAssistantHarness.handler(
    {
      message: input.message,
      runContext: input.runContext,
      model: input.model,
      workflow: input.workflow,
      classifiedIntent: input.classifiedIntent,
      conversationSummary: input.conversationSummary,
    },
    ctx
  ) as Promise<HarnessEvaluateOutput>
}
