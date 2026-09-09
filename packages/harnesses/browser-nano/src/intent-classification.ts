import {
  callModelGenerate,
  type HarnessCapabilityContext,
  collectDecodeFeedback,
  collectModelOutputFeedback,
  collectValidationFeedback,
  defineHarness,
  inferResponseFormatFromFormatter,
  runModelRepairLoop,
  stripMarkdownCodeFences,
  formatStructuredRepairForModel,
  formatModelRepairDialogLines,
  isRepairFeedbackEcho,
  coerceIntentEqlRawOutput,
  buildContextBundle,
  correctClassifiedIntent,
} from "@executioncontrolprotocol/core"
import {
  ECP_INTENT_SCHEMA,
  ECP_MODEL_GENERATE_INTERFACE,
  harnessEvaluateOutputSchema,
  LATEST_ECP_VERSION,
  type EcpIntent,
  type HarnessEvaluateOutput,
  type HarnessInvokeResult,
  type HarnessOperationFeedback,
  type HarnessPromptPhase,
  type ValidationResult,
} from "@executioncontrolprotocol/types"
import { z } from "zod"
import { BROWSER_NANO_HARNESS_ID } from "./harness-ids.js"
import {
  buildNanoRepairHint,
  buildNanoSystemPrompt,
  NANO_PROMPT_FIXTURE_IDS,
} from "./prompts/index.js"

const harnessConfigSchema = z.object({
  promptFixture: z
    .string()
    .default(NANO_PROMPT_FIXTURE_IDS.INTENT_CLASSIFICATION),
  system: z.string().optional(),
  context: z
    .object({
      promptPhase: z.enum(["unfiltered", "contextualized"]).default("unfiltered"),
      includeEnvironmentDescriptor: z.boolean().default(false),
      includeEncodedDescriptor: z.boolean().default(false),
      descriptorFormat: z.string().default("@executioncontrolprotocol/format-toon"),
    })
    .default({}),
  output: z
    .object({
      schema: z.string().default(ECP_INTENT_SCHEMA),
      format: z.string().default("@executioncontrolprotocol/format-eql"),
      validate: z.boolean().default(true),
    })
    .default({}),
  repair: z
    .object({
      enabled: z.boolean().default(true),
      maxAttempts: z.number().default(1),
      includeValidationErrors: z.boolean().default(true),
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
})

/**
 * Eval intent classification harness (@executioncontrolprotocol/evals-intent-classification).
 * @category Evals
 */
const evalsIntentClassificationHarness = defineHarness("@executioncontrolprotocol", "evals-intent-classification-internal")
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
    const system = config.system ?? buildNanoSystemPrompt(promptFixtureId)
    const promptPhase = config.context.promptPhase as HarnessPromptPhase

    const contextBundle = await buildContextBundle(ctx.ecp, {
      phase: promptPhase,
      message: input.message,
      includeEnvironmentDescriptor: config.context.includeEnvironmentDescriptor,
      includeEncodedDescriptor: config.context.includeEncodedDescriptor,
      descriptorFormat,
      outputIsEql,
    })

    const buildPrompt = (repairDialogLines: string[] = []) => {
      const lines = [...contextBundle.lines]
      lines.push(`User message: ${input.message}`)
      if (repairDialogLines.length > 0) {
        lines.push(...repairDialogLines)
      }
      return lines.join("\n")
    }

    const maxAttempts = config.repair.enabled ? 1 + config.repair.maxAttempts : 1
    let lastPrompt = buildPrompt()
    let validation = decodedValidationStub()

    const loopResult = await runModelRepairLoop({
      maxAttempts,
      generate: async ({ attempt, priorFeedback, priorRaw }) => {
        const repairFeedback =
          attempt > 0 && config.repair.includeValidationErrors
            ? formatStructuredRepairForModel(priorFeedback)
            : undefined
        const repairDialogLines =
          attempt > 0 && repairFeedback
            ? formatModelRepairDialogLines({
                includePriorOutput: config.repair.includePriorOutput,
                priorOutputMaxChars: config.repair.priorOutputMaxChars,
                priorRaw,
                repairFeedback,
                repairHint: buildNanoRepairHint(promptFixtureId),
                repairLead: "Previous attempt failed. Fix these issues and return corrected EQL only:",
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
        return { raw: stripMarkdownCodeFences(generated.text) }
      },
      evaluate: async (raw, { attempt, priorFeedback }) => {
        const feedback: HarnessOperationFeedback[] = []

        const normalizedRaw = coerceIntentEqlRawOutput(raw, input.message.trim())

        if (
          attempt > 0 &&
          config.repair.includeValidationErrors &&
          isRepairFeedbackEcho(normalizedRaw, formatStructuredRepairForModel(priorFeedback))
        ) {
          return {
            success: false,
            feedback: [
              collectModelOutputFeedback(
                "Output echoed validation errors instead of a document. Return only intent EQL."
              ),
            ],
          }
        }

        const decoded = await ctx.ecp
          .decode(normalizedRaw)
          .uses(format)
          .to(ECP_INTENT_SCHEMA)
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

        const intentDoc = correctClassifiedIntent(
          input.message.trim(),
          decoded.result as EcpIntent
        )

        return { success: true, artifact: intentDoc, feedback }
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

/** Intent task handler (invoked by unified `@executioncontrolprotocol/harness-evals`). @category Evals */
export async function invokeIntentClassification(
  input: { message: string; model?: string },
  ctx: HarnessCapabilityContext<Record<string, unknown>>
): Promise<HarnessEvaluateOutput> {
  return evalsIntentClassificationHarness.handler(input, ctx) as Promise<HarnessEvaluateOutput>
}

/** @deprecated Use {@link invokeIntentClassification} */
export const invokeEvalIntentClassification = invokeIntentClassification
