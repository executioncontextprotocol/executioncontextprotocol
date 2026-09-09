import { compileWorkflowSource } from "@executioncontrolprotocol/core/compile"
import {
  callModelGenerate,
  collectModelOutputFeedback,
  collectValidationFeedback,
  defineHarness,
  formatEnvironmentSummaryLines,
  formatStructuredRepairForModel,
  HARNESS_OUTPUT_FORMAT_TYPESCRIPT,
  inferResponseFormatFromFormatter,
  isRepairFeedbackEcho,
  renderWorkflowToFluent,
  runModelRepairLoop,
  stripHarnessTypeScriptOutput,
  summarizeEnvironmentDescriptor,
  type HarnessCapabilityContext,
  type CompactEnvironmentSummary,
} from "@executioncontrolprotocol/core"
import {
  buildRequestCapabilityHintLines,
  collectCreateCapabilityFeedback,
  collectCreateStepCountFeedback,
} from "@executioncontrolprotocol/harnesses-browser-nano"
import {
  buildFluentPatchHintLines,
  collectFluentCompileErrorFeedback,
  collectCreateWorkflowIoFeedback,
  collectFluentPatchGoalFeedback,
} from "./fluent-patch-hints.js"
import {
  ECP_MODEL_GENERATE_INTERFACE,
  harnessEvaluateOutputSchema,
  type HarnessEvaluateOutput,
  type HarnessInvokeResult,
  type HarnessOperationFeedback,
  type WorkflowManifest,
} from "@executioncontrolprotocol/types"
import { z } from "zod"
import { BROWSER_CODING_HARNESS_ID } from "./harness-ids.js"
import {
  buildCodingRepairHint,
  buildCodingSystemPrompt,
  CODING_PROMPT_FIXTURE_IDS,
} from "./prompts/index.js"

function existingCapabilityUses(manifest: WorkflowManifest | undefined): Set<string> {
  const uses = new Set<string>()
  if (!manifest) return uses
  for (const node of manifest.steps ?? []) {
    if ("uses" in node && typeof node.uses === "string") {
      uses.add(node.uses)
    }
  }
  return uses
}

const outputConfigSchema = z.object({
  schema: z.string().default("@executioncontrolprotocol.workflow"),
  format: z.string().default(HARNESS_OUTPUT_FORMAT_TYPESCRIPT),
  validate: z.boolean().default(true),
})

const harnessConfigSchema = z.object({
  promptFixture: z.string().optional(),
  system: z.string().optional(),
  context: z
    .object({
      includeEnvironmentDescriptor: z.boolean().default(true),
      includeEncodedDescriptor: z.boolean().default(false),
      descriptorFormat: z.string().default("@executioncontrolprotocol/format-json"),
    })
    .default({}),
  output: outputConfigSchema.default({}),
  repair: z
    .object({
      enabled: z.boolean().default(true),
      maxAttempts: z.number().default(1),
      includeValidationErrors: z.boolean().default(true),
    })
    .default({}),
  trace: z
    .object({
      includePrompt: z.boolean().default(true),
      includeRawOutput: z.boolean().default(true),
      includeValidation: z.boolean().default(true),
      includeRepairAttempts: z.boolean().default(true),
    })
    .default({}),
})

const harnessInputSchema = z.object({
  request: z.string(),
  manifest: z.unknown().optional(),
  model: z.string().optional(),
})

const codingWorkflowAuthoringHarness = defineHarness("@executioncontrolprotocol", "browser-coding-workflow-authoring")
  .withConfig(harnessConfigSchema)
  .withInput(harnessInputSchema)
  .withOutput(harnessEvaluateOutputSchema)
  .usesProviderInterface(ECP_MODEL_GENERATE_INTERFACE)
  .withHandler(async (input, ctx) => {
    const config = ctx.config
    const isPatch = input.manifest !== undefined
    const format = config.output.format
    const baselineManifest = isPatch
      ? (input.manifest as WorkflowManifest | undefined)
      : undefined

    const promptFixtureId =
      config.promptFixture ??
      (isPatch
        ? CODING_PROMPT_FIXTURE_IDS.WORKFLOW_AUTHORING_PATCH
        : CODING_PROMPT_FIXTURE_IDS.WORKFLOW_AUTHORING_CREATE)

    const system =
      config.system ?? buildCodingSystemPrompt(promptFixtureId)

    let environmentSummaryLines = ""
    let environmentSummary: CompactEnvironmentSummary | undefined

    if (config.context.includeEnvironmentDescriptor) {
      const descriptor = await ctx.ecp.describe()
      environmentSummary = summarizeEnvironmentDescriptor(descriptor)
      environmentSummaryLines = formatEnvironmentSummaryLines(environmentSummary, {
        format: "plain",
        existingCapabilityUses: isPatch
          ? existingCapabilityUses(baselineManifest)
          : undefined,
      }).join("\n")
    }

    const buildPrompt = (repairText?: string) => {
      const requestHints =
        environmentSummary !== undefined
          ? buildRequestCapabilityHintLines(input.request, environmentSummary, {
              mode: isPatch ? "patch" : "create",
            })
          : []
      const patchHints =
        isPatch && baselineManifest
          ? buildFluentPatchHintLines(
              input.request,
              baselineManifest,
              environmentSummary?.capabilities.map((c) => c.id)
            )
          : []
      const envBlock = environmentSummaryLines
        ? ["Environment capabilities:", environmentSummaryLines, ""]
        : []

      const importHint =
        'Required import: import { workflow, step, ref } from "@executioncontrolprotocol/core" (include ref when any step uses ref()).'

      const lines = isPatch
        ? [
            `User request: ${input.request}`,
            importHint,
            ...(patchHints.length > 0 ? ["Fluent edit rules:", ...patchHints, ""] : []),
            "Current workflow:",
            baselineManifest ? renderWorkflowToFluent(baselineManifest) : "",
            ...requestHints,
            ...envBlock,
          ]
        : [
            `User request: ${input.request}`,
            importHint,
            ...requestHints,
            ...envBlock,
          ]

      if (repairText) {
        lines.push(
          "Previous attempt failed. Output only corrected TypeScript:",
          repairText,
          buildCodingRepairHint(promptFixtureId)
        )
      }
      return lines.filter((l) => l.length > 0).join("\n")
    }

    const responseFormat = inferResponseFormatFromFormatter(format)
    const maxAttempts = config.repair.enabled ? 1 + config.repair.maxAttempts : 1
    let lastPrompt = buildPrompt()

    const loopResult = await runModelRepairLoop({
      maxAttempts,
      generate: async ({ attempt, priorFeedback }) => {
        const repairText =
          attempt > 0 && config.repair.includeValidationErrors
            ? formatStructuredRepairForModel(priorFeedback)
            : undefined
        lastPrompt = buildPrompt(repairText)
        const generated = await callModelGenerate(
          ctx.uses,
          { prompt: lastPrompt, system, model: input.model, responseFormat },
          ctx.capabilityContext,
          format
        )
        return { raw: stripHarnessTypeScriptOutput(generated.text) }
      },
      evaluate: async (raw, { priorFeedback }) => {
        const feedback: HarnessOperationFeedback[] = []
        const structuredPrior = formatStructuredRepairForModel(priorFeedback)
        if (
          config.repair.includeValidationErrors &&
          isRepairFeedbackEcho(raw, structuredPrior)
        ) {
          return {
            success: false,
            feedback: [
              collectModelOutputFeedback(
                "Output echoed validation errors. Return only the TypeScript workflow module."
              ),
            ],
          }
        }

        const compiled = await compileWorkflowSource({
          source: raw,
          filename: isPatch ? "workflow-patch.ts" : "workflow-create.ts",
          // Browser blob eval cannot resolve package specifiers; Node compile ignores this.
          resolveImports: "browser-global",
        })

        if (!compiled.ok || !compiled.manifest) {
          const msg =
            compiled.compileErrors?.map((e) => e.message).join("; ") ??
            "TypeScript compile failed"
          feedback.push(collectModelOutputFeedback(msg))
          const fluentCompile = collectFluentCompileErrorFeedback(msg)
          if (fluentCompile) {
            feedback.push(...fluentCompile)
          }
          if (compiled.validation) {
            feedback.push(collectValidationFeedback(compiled.validation))
          }
          return { success: false, feedback }
        }

        const artifact: WorkflowManifest = compiled.manifest

        if (config.output.validate) {
          const validation = await ctx.ecp.validate(artifact)
          feedback.push(collectValidationFeedback(validation))
          if (!validation.valid) {
            return { success: false, feedback }
          }
        }

        if (!isPatch && environmentSummary) {
          const capFeedback = collectCreateCapabilityFeedback(
            input.request,
            environmentSummary,
            artifact
          )
          if (capFeedback) {
            return { success: false, feedback: [...feedback, ...capFeedback] }
          }
          const stepCountFeedback = collectCreateStepCountFeedback(input.request, artifact)
          if (stepCountFeedback) {
            return { success: false, feedback: [...feedback, ...stepCountFeedback] }
          }
          const ioFeedback = collectCreateWorkflowIoFeedback(input.request, artifact)
          if (ioFeedback) {
            return { success: false, feedback: [...feedback, ...ioFeedback] }
          }
        }
        if (isPatch && environmentSummary) {
          const patchFeedback = collectFluentPatchGoalFeedback(
            input.request,
            artifact,
            environmentSummary,
            baselineManifest
          )
          if (patchFeedback) {
            return { success: false, feedback: [...feedback, ...patchFeedback] }
          }
        }

        return { success: true, artifact, feedback }
      },
    })

    const validation = await ctx.ecp.validate(loopResult.artifact as WorkflowManifest)

    const trace: HarnessInvokeResult["trace"] & Record<string, unknown> = {
      harness: BROWSER_CODING_HARNESS_ID,
      provider: ctx.uses,
      model: input.model,
      outputSchema: "@executioncontrolprotocol.workflow",
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
  })
  .build()

/** Workflow authoring for Browser Coding harness. @category Harness */
export async function invokeWorkflowAuthoringCoding(
  input: {
    request: string
    manifest?: unknown
    model?: string
    probeContext?: unknown
  },
  ctx: HarnessCapabilityContext<Record<string, unknown>>
): Promise<HarnessEvaluateOutput> {
  return codingWorkflowAuthoringHarness.handler(
    { request: input.request, manifest: input.manifest, model: input.model },
    ctx
  ) as Promise<HarnessEvaluateOutput>
}
