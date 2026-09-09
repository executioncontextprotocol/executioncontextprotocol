import {
  callModelGenerate,
  collectDecodeFeedback,
  collectModelOutputFeedback,
  collectPatchFeedback,
  collectValidationFeedback,
  defineHarness,
  type HarnessCapabilityContext,
  formatSchemaExampleEql,
  formatSchemaExampleJson,
  inferResponseFormatFromFormatter,
  runModelRepairLoop,
  stripMarkdownCodeFences,
  buildContextBundle,
  formatClassifiedIntentBlock,
  formatWorkflowSummaryLines,
  normalizePatchEqlRawOutput,
  substitutePatchRepairTemplate,
  normalizeMalformedPatchStepLabel,
  sanitizePatchEqlRawOutput,
  recoverPatchFromRepairHintProse,
  recoverMinimalLabelPatch,
  recoverTroubleshootStepPatch,
  recoverStructuredPatchFromRequest,
  selectBestWorkflowEqlBlock,
  normalizeCreateEqlRawOutput,
  filterWorkflowEqlToRequiredCapabilities,
  synthesizeCreateEqlFromRequiredCapabilities,
  createEqlIncludesRequiredCapabilities,
  normalizeWorkflowDocumentCandidate,
  formatStructuredRepairForModel,
  formatModelRepairDialogLines,
  isRepairFeedbackEcho,
  isRepairTemplateEcho,
  summarizeEnvironmentDescriptor,
  type CompactEnvironmentSummary,
} from "@executioncontrolprotocol/core"
import {
  ECP_CORE_FORMATTER_IDS,
  ECP_MODEL_GENERATE_INTERFACE,
  ecpIntentSchema,
  harnessEvaluateOutputSchema,
  probeContextSchema,
  type EcpPatchInput,
  type EcpPatchDocument,
  type EcpIntent,
  type HarnessEvaluateOutput,
  type HarnessInvokeResult,
  type HarnessOperationFeedback,
  type HarnessPromptPhase,
  type ProbeContext,
  type WorkflowManifest,
} from "@executioncontrolprotocol/types"
import { z } from "zod"
import {
  buildPatchOperationHintLines,
  buildRequestCapabilityHintLines,
  collectPatchGoalFeedback,
  collectCreateCapabilityFeedback,
  collectCreateDuplicateStepIdFeedback,
  collectCreateStepCountFeedback,
  collectCreateWorkflowIoFeedback,
  inferPatchTargetStepId,
  inferRequestedLabel,
  inferRequiredCapabilityIds,
} from "./_internal/request-capability-hints.js"
import { BROWSER_NANO_HARNESS_ID } from "./harness-ids.js"
import {
  buildNanoRepairHint,
  buildNanoSystemPrompt,
  NANO_PROMPT_FIXTURE_IDS,
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

function alignPatchWorkflowId(
  patch: EcpPatchDocument,
  baseline: WorkflowManifest
): EcpPatchDocument {
  const expectedId = baseline.workflow?.id
  if (!expectedId) return patch
  return {
    ...patch,
    patches: patch.patches.map((entry) =>
      entry.path === "workflow.id" ? { ...entry, value: expectedId } : entry
    ),
  }
}

const outputConfigSchema = z.object({
  schema: z.string().default("@executioncontrolprotocol.workflow"),
  format: z.string().default("@executioncontrolprotocol/format-json"),
  validate: z.boolean().default(true),
})

const harnessConfigSchema = z.object({
  promptFixture: z.string().optional(),
  system: z.string().optional(),
  context: z
    .object({
      promptPhase: z.enum(["unfiltered", "contextualized"]).default("contextualized"),
      includeEnvironmentDescriptor: z.boolean().default(true),
      /** When false, only plain-text capability lines are sent (smaller prompts for 1B models). */
      includeEncodedDescriptor: z.boolean().default(true),
      descriptorFormat: z.string().default("@executioncontrolprotocol/format-toon"),
    })
    .default({}),
  output: outputConfigSchema.default({}),
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
  classifiedIntent: ecpIntentSchema.optional(),
  conversationSummary: z.string().optional(),
  probeContext: probeContextSchema.optional(),
})

/**
 * Eval workflow authoring harness (@executioncontrolprotocol/evals-workflow-authoring).
 * @category Evals
 */
const evalsWorkflowAuthoringHarness = defineHarness("@executioncontrolprotocol", "evals-workflow-authoring-internal")
  .withConfig(harnessConfigSchema)
  .withInput(harnessInputSchema)
  .withOutput(harnessEvaluateOutputSchema)
  .usesProviderInterface(ECP_MODEL_GENERATE_INTERFACE)
  .withHandler(async (input, ctx) => {
    const config = ctx.config
    const isPatch = input.manifest !== undefined
    const outputSchema = isPatch ? "@executioncontrolprotocol.patch" : config.output.schema
    const format = config.output.format
    const descriptorFormat = config.context.descriptorFormat ?? format
    const outputIsJson =
      format === ECP_CORE_FORMATTER_IDS.JSON || format.endsWith("/format-json")
    const outputIsEql = format === "@executioncontrolprotocol/format-eql" || format.endsWith("/format-eql")

    const promptFixtureId =
      config.promptFixture ??
      (isPatch
        ? NANO_PROMPT_FIXTURE_IDS.WORKFLOW_AUTHORING_PATCH
        : NANO_PROMPT_FIXTURE_IDS.WORKFLOW_AUTHORING_CREATE)

    const system =
      config.system ?? buildNanoSystemPrompt(promptFixtureId)

    const promptPhase = config.context.promptPhase as HarnessPromptPhase

    let environmentSummary: CompactEnvironmentSummary | undefined
    const baselineManifest = isPatch
      ? (input.manifest as WorkflowManifest | undefined)
      : undefined

    if (config.context.includeEnvironmentDescriptor) {
      environmentSummary = summarizeEnvironmentDescriptor(await ctx.ecp.describe())
    }

    const contextBundle = await buildContextBundle(ctx.ecp, {
      phase: promptPhase,
      message: input.request,
      intent: input.classifiedIntent?.intent ?? (isPatch ? "workflow-patch" : "workflow-create"),
      manifest: baselineManifest,
      conversationSummary: input.conversationSummary,
      probeContext: input.probeContext,
      includeEnvironmentDescriptor: config.context.includeEnvironmentDescriptor,
      includeEncodedDescriptor: config.context.includeEncodedDescriptor,
      descriptorFormat,
      outputIsEql,
      isPatch,
      existingCapabilityUses: isPatch
        ? existingCapabilityUses(baselineManifest)
        : undefined,
    })

    let workflowSummaryText = ""
    if (isPatch && baselineManifest) {
      workflowSummaryText = formatWorkflowSummaryLines(baselineManifest, {
        eql: outputIsEql,
        patchContext: true,
      }).join("\n")
    }

    const buildPrompt = (repairDialogLines: string[] = []) => {
      const requestHints =
        environmentSummary !== undefined
          ? buildRequestCapabilityHintLines(input.request, environmentSummary, {
              mode: isPatch ? "patch" : "create",
            })
          : []
      const patchHints =
        isPatch && baselineManifest
          ? buildPatchOperationHintLines(
              input.request,
              baselineManifest,
              environmentSummary?.capabilities.map((c) => c.id)
            )
          : []
      const envBlock = contextBundle.lines.length > 0 ? [...contextBundle.lines, ""] : []
      const classifiedBlock = input.classifiedIntent
        ? [...formatClassifiedIntentBlock(input.classifiedIntent), ""]
        : []
      const createOutputLine = outputIsEql
        ? /\bminimal\b/i.test(input.request) || /\bone step\b/i.test(input.request)
          ? "Return only compact headerless EQL for @executioncontrolprotocol.workflow with exactly ONE STEP line."
          : "Return only compact headerless EQL for @executioncontrolprotocol.workflow."
        : outputIsJson
          ? "Return only a compact JSON @executioncontrolprotocol.workflow document for this request."
          : `Return only a compact @executioncontrolprotocol.workflow document encoded as ${format} for this request.`
      const patchOutputLine = outputIsEql
        ? "Apply the user request to the current workflow. Return EQL patch operations only. First line MUST be PATCH WORKFLOW <id from user prompt>, then UPDATE WORKFLOW / UPDATE STEP / ADD STEP / DELETE STEP / MOVE STEP as needed. Do not re-list unchanged steps."
        : outputIsJson
          ? "Return only compact JSON for schema @executioncontrolprotocol.patch."
          : `Return only a compact @executioncontrolprotocol.patch document encoded as ${format}.`
      const lines = isPatch
        ? [
            ...classifiedBlock,
            patchOutputLine,
            `User request: ${input.request}`,
            ...patchHints,
            "Current workflow (EQL reference):",
            workflowSummaryText,
            ...requestHints,
            ...envBlock,
          ]
        : [
            ...classifiedBlock,
            createOutputLine,
            "Output only STEP lines for capabilities explicitly named in the user request. Do not invent steps from the environment inventory.",
            `User request: ${input.request}`,
            ...requestHints,
            ...envBlock,
            // Suppress single-step schema example when specific multi-step requirements
            // are already in the prompt — it anchors the 1B model to single-step outputs.
            ...((outputIsEql || outputIsJson) && requestHints.length === 0
              ? [
                  `Example output shape:\n${
                    outputIsEql
                      ? formatSchemaExampleEql("@executioncontrolprotocol.workflow")
                      : formatSchemaExampleJson("@executioncontrolprotocol.workflow")
                  }`,
                ]
              : []),
          ]
      if (repairDialogLines.length > 0) {
        lines.push(...repairDialogLines)
      }
      return lines.join("\n")
    }

    const responseFormat = inferResponseFormatFromFormatter(format)
    const maxAttempts = config.repair.enabled ? 1 + config.repair.maxAttempts : 1
    let lastPrompt = buildPrompt()

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
                repairLead: "Previous attempt failed. Do not repeat error text. Output only the corrected document:",
              })
            : []
        lastPrompt = buildPrompt(repairDialogLines)
        const generated = await callModelGenerate(
          ctx.uses,
          { prompt: lastPrompt, system, model: input.model, responseFormat },
          ctx.capabilityContext,
          format
        )
        return { raw: stripMarkdownCodeFences(generated.text) }
      },
      evaluate: async (raw, { priorFeedback }) => {
        const baseline = baselineManifest as WorkflowManifest | undefined
        const stepIds =
          baseline?.steps
            ?.filter((s) => "uses" in s && typeof s.uses === "string")
            .map((s) => s.id) ?? []
        const workflowId = baseline?.workflow?.id
        if (
          !isPatch &&
          outputIsEql
        ) {
          const requiredCaps =
            environmentSummary !== undefined
              ? inferRequiredCapabilityIds(
                  input.request,
                  environmentSummary.capabilities.map((c) => c.id)
                )
              : []
          if ((raw.match(/^WORKFLOW /gm)?.length ?? 0) > 1) {
            raw = selectBestWorkflowEqlBlock(raw, requiredCaps)
          }
          raw = raw
            .replace(/@executioncontrolprotocol\/demo\.summarizes\b/g, "@executioncontrolprotocol/chrome-ai.generate")
          raw = normalizeCreateEqlRawOutput(raw)
          if (requiredCaps.length > 0) {
            if (!createEqlIncludesRequiredCapabilities(raw, requiredCaps)) {
              const synthesized = synthesizeCreateEqlFromRequiredCapabilities(
                input.request,
                requiredCaps
              )
              if (synthesized) {
                raw = synthesized
              }
            } else {
              raw = filterWorkflowEqlToRequiredCapabilities(raw, requiredCaps)
            }
          }
        }

        const targetStepId = inferPatchTargetStepId(input.request, stepIds)
        const requestedLabel = inferRequestedLabel(input.request)
        const patchCapabilityIds =
          environmentSummary !== undefined
            ? inferRequiredCapabilityIds(
                input.request,
                environmentSummary.capabilities.map((c) => c.id)
              )
            : []
        let patchRaw = isPatch ? sanitizePatchEqlRawOutput(raw) : raw
        if (isPatch && workflowId) {
          const recovered =
            recoverPatchFromRepairHintProse(
              patchRaw,
              workflowId,
              targetStepId,
              requestedLabel
            ) ??
            recoverMinimalLabelPatch(patchRaw, workflowId, targetStepId, requestedLabel) ??
            recoverStructuredPatchFromRequest(patchRaw, {
              request: input.request,
              workflowId: workflowId!,
              stepIds,
              capabilityIds: patchCapabilityIds,
              targetStepId,
              requestedLabel,
            }) ??
            recoverTroubleshootStepPatch(input.request, patchRaw, workflowId, targetStepId)
          if (recovered) {
            patchRaw = recovered
          }
        }

        const patchNormalized = isPatch
          ? normalizeMalformedPatchStepLabel(
              normalizePatchEqlRawOutput(patchRaw, workflowId),
              targetStepId,
              requestedLabel
            )
          : undefined
        if (isPatch && patchNormalized && isRepairTemplateEcho(patchNormalized)) {
          return {
            success: false,
            feedback: [
              collectModelOutputFeedback(
                "Use real workflow and step ids from the current workflow. Do not output example-wf, example-step, or repair placeholders."
              ),
            ],
          }
        }
        if (isPatch && outputIsEql && /^\s*[\[{]/.test(raw.trim())) {
          return {
            success: false,
            feedback: [
              collectModelOutputFeedback(
                "Output @executioncontrolprotocol.patch EQL only (PATCH WORKFLOW ...). Do not output JSON."
              ),
            ],
          }
        }

        const normalizedRaw =
          isPatch && outputIsEql
            ? substitutePatchRepairTemplate(
                patchNormalized!,
                workflowId,
                targetStepId,
                requestedLabel
              )
            : raw
        const feedback: HarnessOperationFeedback[] = []

        if (
          !isPatch &&
          outputIsJson &&
          !outputIsEql &&
          (raw.match(/"schema"\s*:\s*"@executioncontrolprotocol\.workflow"/g)?.length ?? 0) > 1
        ) {
          return {
            success: false,
            feedback: [
              collectModelOutputFeedback(
                "Return exactly one @executioncontrolprotocol.workflow JSON object. Do not output multiple documents or examples."
              ),
            ],
          }
        }

        const structuredPrior = formatStructuredRepairForModel(priorFeedback)
        if (
          config.repair.includeValidationErrors &&
          isRepairFeedbackEcho(normalizedRaw, structuredPrior)
        ) {
          return {
            success: false,
            feedback: [
              collectModelOutputFeedback(
                "Output echoed validation errors instead of a document. Return only the workflow or patch document."
              ),
            ],
          }
        }

        const decodeOptions = outputIsEql
          ? { headers: false as const }
          : { headers: false as const, compact: true }

        const decoded = await ctx.ecp
          .decode(normalizedRaw)
          .uses(format)
          .to(isPatch ? "@executioncontrolprotocol.patch" : "@executioncontrolprotocol.workflow")
          .with(decodeOptions)
          .process()

        let document = decoded.result
        if (!isPatch && document !== undefined && outputIsJson && !outputIsEql) {
          document = normalizeWorkflowDocumentCandidate(document)
        }

        feedback.push(collectDecodeFeedback(decoded))

        if (!decoded.success || document === undefined) {
          if (isPatch && outputIsEql && /^\s*[\[{]/.test(raw.trim())) {
            feedback.push(
              collectModelOutputFeedback(
                "Output @executioncontrolprotocol.patch EQL only (PATCH WORKFLOW ...). Do not output JSON."
              )
            )
          }
          if (!isPatch && outputIsJson && !outputIsEql && document !== undefined) {
            const validation = await ctx.ecp.validate(document as WorkflowManifest)
            feedback.push(collectValidationFeedback(validation))
            if (validation.valid) {
              return { success: true, artifact: document, feedback }
            }
          }
          return { success: false, feedback }
        }

        let artifact: unknown = document

        if (isPatch && input.manifest) {
          if (document && typeof document === "object" && "patches" in document) {
            document = alignPatchWorkflowId(
              document as EcpPatchDocument,
              input.manifest as WorkflowManifest
            )
          }
          const patched = await ctx.ecp
            .patch(input.manifest as WorkflowManifest)
            .with(artifact as EcpPatchInput)
            .process()
          feedback.push(collectPatchFeedback(patched))
          if (!patched.success || !patched.result) {
            const duplicateStep = patched.diagnostics?.some((d) =>
              /Duplicate step id/i.test(d.message ?? "")
            )
            const unknownStep = patched.diagnostics?.some((d) =>
              /Step not found:/i.test(d.message ?? "")
            )
            if (duplicateStep) {
              const moveMatch = input.request.match(
                /\bmove\s+(?:the\s+)?(\w+)\s+(?:step\s+)?(?:to\s+run\s+)?(after|before)\s+(\w+)/i
              )
              feedback.push(
                collectModelOutputFeedback(
                  moveMatch
                    ? `Use MOVE STEP ${moveMatch[1]} ${moveMatch[2]!.toUpperCase()} ${moveMatch[3]}. Do not ADD STEP ${moveMatch[3]} — that step already exists.`
                    : "A step id in ADD STEP already exists in the workflow. Use UPDATE STEP to change it, not ADD STEP with the same id."
                )
              )
            } else if (unknownStep && baseline) {
              const allowed =
                baseline.steps
                  ?.filter((s) => "uses" in s && typeof s.uses === "string")
                  .map((s) => s.id)
                  .join(", ") ?? "none"
              feedback.push(
                collectModelOutputFeedback(
                  `Patch references a step id not in this workflow. Existing step ids: ${allowed}. Use only those ids (or a new id for ADD STEP).`
                )
              )
            }
            return { success: false, feedback }
          }
          artifact = patched.result
        }

        if (config.output.validate) {
          const validation = await ctx.ecp.validate(artifact as WorkflowManifest)
          feedback.push(collectValidationFeedback(validation))
          if (!validation.valid) {
            if (
              !isPatch &&
              validation.errors.some((d) => /Duplicate step id/i.test(d.message ?? ""))
            ) {
              const dupFeedback = collectCreateDuplicateStepIdFeedback(artifact as WorkflowManifest)
              if (dupFeedback) {
                feedback.push(...dupFeedback)
              }
            }
            return { success: false, feedback }
          }
        }

        const wfArtifact = artifact as WorkflowManifest
        if (!isPatch && environmentSummary) {
          const capFeedback = collectCreateCapabilityFeedback(
            input.request,
            environmentSummary,
            wfArtifact
          )
          if (capFeedback) {
            return { success: false, feedback: [...feedback, ...capFeedback] }
          }
          const requiredCaps =
            environmentSummary !== undefined
              ? inferRequiredCapabilityIds(
                  input.request,
                  environmentSummary.capabilities.map((c) => c.id)
                )
              : []
          const stepCountFeedback = collectCreateStepCountFeedback(
            input.request,
            wfArtifact,
            requiredCaps
          )
          if (stepCountFeedback) {
            return { success: false, feedback: [...feedback, ...stepCountFeedback] }
          }
          const ioFeedback = collectCreateWorkflowIoFeedback(input.request, wfArtifact)
          if (ioFeedback) {
            return { success: false, feedback: [...feedback, ...ioFeedback] }
          }
        }
        if (isPatch && environmentSummary) {
          const patchFeedback = collectPatchGoalFeedback(
            input.request,
            wfArtifact,
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

    const includeSystemPrompt =
      typeof process !== "undefined" &&
      process.env.ECP_EVAL_DEBUG_INCLUDE_SYSTEM_PROMPT?.trim() !== "" &&
      process.env.ECP_EVAL_DEBUG_INCLUDE_SYSTEM_PROMPT?.toLowerCase() !== "0" &&
      process.env.ECP_EVAL_DEBUG_INCLUDE_SYSTEM_PROMPT?.toLowerCase() !== "false" &&
      process.env.ECP_EVAL_DEBUG_INCLUDE_SYSTEM_PROMPT?.toLowerCase() !== "off"

    const trace: HarnessInvokeResult["trace"] & Record<string, unknown> = {
      harness: BROWSER_NANO_HARNESS_ID,
      provider: ctx.uses,
      model: input.model,
      outputSchema,
      outputFormat: format,
        decodeSucceeded: true,
        validationSucceeded: validation.valid,
        promptPhase,
      ...(config.trace.includePrompt ? { prompt: lastPrompt } : {}),
      ...(config.trace.includeRawOutput ? { rawOutput: loopResult.raw } : {}),
      ...(config.trace.includeRepairAttempts ? { repairAttempts: loopResult.attempts } : {}),
      ...(includeSystemPrompt ? { systemPrompt: system } : {}),
    }

    return {
      artifact: loopResult.artifact,
      raw: loopResult.raw,
      ...(config.trace.includeValidation ? { validation } : {}),
      trace,
    }
  })
  .build()

/** Workflow authoring task handler (invoked by unified `@executioncontrolprotocol/harness-evals`). @category Evals */
export async function invokeWorkflowAuthoring(
  input: {
    request: string
    manifest?: unknown
    model?: string
    classifiedIntent?: EcpIntent
    conversationSummary?: string
    probeContext?: ProbeContext
  },
  ctx: HarnessCapabilityContext<Record<string, unknown>>
): Promise<HarnessEvaluateOutput> {
  return evalsWorkflowAuthoringHarness.handler(input, ctx) as Promise<HarnessEvaluateOutput>
}

/** @deprecated Use {@link invokeWorkflowAuthoring} */
export const invokeEvalWorkflowAuthoring = invokeWorkflowAuthoring
