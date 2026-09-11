import type { HarnessCapabilityContext } from "@executioncontrolprotocol/core"
import {
  buildAuthoringFailureReply,
  chatResultAnswer,
  chatResultSuggestedAction,
  chatResultWorkflow,
  formatWorkflowSummaryLines,
  messageSelectsProbeOptions,
  tryBuildChangeSummaryReply,
  tryBuildClarifyOptionsReply,
  tryBuildProbeOfferReply,
} from "@executioncontrolprotocol/core"
import {
  ECP_HARNESS_REPLY_ACTIONS,
  ECP_HARNESS_REPLY_SCHEMA,
  ECP_INTENT_VALUES,
  probeContextSchema,
  type EcpIntent,
  type HarnessEvaluateOutput,
  type HarnessInvokeResult,
  type HarnessReply,
  type HarnessShotTrace,
  type ProbeContext,
  type WorkflowManifest,
} from "@executioncontrolprotocol/types"
import {
  intentRoutesToAuthoring,
  intentRoutesToClarify,
  WORKFLOW_CHANGE_SUMMARY_SHOT_TASK,
} from "@executioncontrolprotocol/harnesses-browser-nano"
import {
  HARNESS_TASKS,
  getHarnessCodingConfig,
  HARNESS_CODING_CHAT_REPAIR,
} from "./harness-coding-config.js"
import { BROWSER_CODING_HARNESS_ID } from "./harness-ids.js"
import { invokeIntentClassificationCoding } from "./intent-classification-coding.js"
import { invokeWorkflowAssistantCoding } from "./workflow-assistant-coding.js"
import { invokeWorkflowAuthoringCoding } from "./workflow-authoring-coding.js"
import { CODING_PROMPT_FIXTURE_IDS } from "./prompts/index.js"

function shotFromTrace(
  task: string,
  promptPhase: "unfiltered" | "contextualized",
  result: HarnessEvaluateOutput,
  outputSchema?: string
): HarnessShotTrace {
  return {
    task,
    promptPhase,
    ...(result.trace.prompt ? { prompt: result.trace.prompt } : {}),
    ...(result.trace.rawOutput ? { rawOutput: result.trace.rawOutput } : {}),
    ...(result.trace.repairAttempts ? { repairAttempts: result.trace.repairAttempts } : {}),
    ...(outputSchema ? { outputSchema } : {}),
  }
}

function isWorkflowArtifact(value: unknown): value is WorkflowManifest {
  return (
    value !== null &&
    typeof value === "object" &&
    "schema" in value &&
    (value as { schema?: string }).schema === "@executioncontrolprotocol.workflow"
  )
}

function isHarnessReplyArtifact(value: unknown): value is HarnessReply {
  return (
    value !== null &&
    typeof value === "object" &&
    "schema" in value &&
    (value as { schema?: string }).schema === ECP_HARNESS_REPLY_SCHEMA &&
    typeof (value as { answer?: unknown }).answer === "string"
  )
}

function ensureOfferRun(reply: HarnessReply): HarnessReply {
  if (reply.suggestedAction === ECP_HARNESS_REPLY_ACTIONS.OFFER_RUN) {
    return reply
  }
  return { ...reply, suggestedAction: ECP_HARNESS_REPLY_ACTIONS.OFFER_RUN }
}

function ensureOfferProbe(reply: HarnessReply): HarnessReply {
  if (reply.suggestedAction === ECP_HARNESS_REPLY_ACTIONS.OFFER_PROBE) {
    return reply
  }
  return { ...reply, suggestedAction: ECP_HARNESS_REPLY_ACTIONS.OFFER_PROBE }
}

function buildChangeSummaryMessage(
  userRequest: string,
  baseline: WorkflowManifest | undefined,
  authored: WorkflowManifest,
  mode: "run" | "probe"
): string {
  const ask =
    mode === "probe"
      ? "Summarize the discovery prefix in one or two short sentences, then ask if the user wants to run the probe to inspect results before finishing."
      : "Summarize the workflow changes below in one or two short sentences, then ask if the user wants to run the workflow."
  const lines = [ask, `User request: ${userRequest}`]
  if (baseline) {
    lines.push("Before:", ...formatWorkflowSummaryLines(baseline))
  } else {
    lines.push("Before: (new workflow)")
  }
  lines.push("After:", ...formatWorkflowSummaryLines(authored))
  return lines.join("\n")
}

function parseProbeContext(value: unknown): ProbeContext | undefined {
  const parsed = probeContextSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/**
 * Multi-shot chat orchestrator for Browser Coding: intent → probe/clarify/author/assist.
 * @category Harness
 */
export async function invokeMultiShotChatCoding(
  input: {
    message: string
    manifest?: unknown
    runContext?: unknown
    probeContext?: unknown
    conversationSummary?: string
    model?: string
    files?: unknown[]
  },
  ctx: HarnessCapabilityContext<Record<string, unknown>>
): Promise<HarnessEvaluateOutput> {
  const probeContext = parseProbeContext(input.probeContext)
  const intentDefaults = getHarnessCodingConfig(HARNESS_TASKS.INTENT_CLASSIFICATION) as Record<
    string,
    Record<string, unknown>
  >
  const intentCtx: HarnessCapabilityContext<Record<string, unknown>> = {
    ...ctx,
    config: {
      ...intentDefaults,
      ...ctx.config,
      context: {
        ...intentDefaults.context,
        ...(ctx.config.context as Record<string, unknown> | undefined),
        promptPhase: "unfiltered",
        includeEnvironmentDescriptor: false,
        includeEncodedDescriptor: false,
      },
      repair: {
        ...intentDefaults.repair,
        ...(ctx.config.repair as Record<string, unknown> | undefined),
        ...HARNESS_CODING_CHAT_REPAIR,
      },
      trace: { ...intentDefaults.trace, ...(ctx.config.trace as Record<string, unknown> | undefined) },
    },
  }

  const intentResult = await invokeIntentClassificationCoding(
    { message: input.message, model: input.model },
    intentCtx
  )
  const classifiedIntent = intentResult.artifact as EcpIntent

  const buildTaskConfig = (
    task: typeof HARNESS_TASKS.WORKFLOW_AUTHORING | typeof HARNESS_TASKS.WORKFLOW_ASSISTANT,
    overrides?: Record<string, unknown>
  ): Record<string, unknown> => {
    const taskDefaults = getHarnessCodingConfig(task) as Record<string, Record<string, unknown>>
    return {
      ...taskDefaults,
      ...ctx.config,
      ...overrides,
      context: {
        ...taskDefaults.context,
        ...(ctx.config.context as Record<string, unknown> | undefined),
        promptPhase: "contextualized",
        ...((overrides?.context as Record<string, unknown> | undefined) ?? {}),
      },
      repair: {
        ...taskDefaults.repair,
        ...(ctx.config.repair as Record<string, unknown> | undefined),
        ...HARNESS_CODING_CHAT_REPAIR,
        ...((overrides?.repair as Record<string, unknown> | undefined) ?? {}),
      },
      trace: {
        ...taskDefaults.trace,
        ...(ctx.config.trace as Record<string, unknown> | undefined),
        ...((overrides?.trace as Record<string, unknown> | undefined) ?? {}),
      },
    }
  }

  const shots: HarnessShotTrace[] = [
    shotFromTrace(
      HARNESS_TASKS.INTENT_CLASSIFICATION,
      "unfiltered",
      intentResult,
      "@executioncontrolprotocol.intent"
    ),
  ]

  let finalResult: HarnessEvaluateOutput

  const runAuthoringPath = async (opts: {
    request: string
    forcePatch: boolean
    offer: "run" | "probe"
    probe?: ProbeContext
  }): Promise<HarnessEvaluateOutput> => {
    const isPatch = opts.forcePatch || input.manifest !== undefined
    const baseline = isPatch && isWorkflowArtifact(input.manifest) ? input.manifest : undefined
    let authoringResult: HarnessEvaluateOutput | undefined
    let authoringError: string | undefined

    try {
      authoringResult = await invokeWorkflowAuthoringCoding(
        {
          request: opts.request,
          manifest: isPatch ? input.manifest : undefined,
          model: input.model,
          probeContext: opts.probe,
          files: input.files,
        },
        { ...ctx, config: buildTaskConfig(HARNESS_TASKS.WORKFLOW_AUTHORING) }
      )
    } catch (err) {
      authoringError = err instanceof Error ? err.message : String(err)
    }

    if (authoringResult) {
      shots.push(
        shotFromTrace(
          HARNESS_TASKS.WORKFLOW_AUTHORING,
          "contextualized",
          authoringResult,
          isPatch ? "@executioncontrolprotocol.patch" : "@executioncontrolprotocol.workflow"
        )
      )
    }

    const authored =
      authoringResult && isWorkflowArtifact(authoringResult.artifact)
        ? authoringResult.artifact
        : undefined

    if (authored) {
      const summaryConfig = buildTaskConfig(HARNESS_TASKS.WORKFLOW_ASSISTANT, {
        promptFixture: CODING_PROMPT_FIXTURE_IDS.WORKFLOW_CHANGE_SUMMARY,
      })
      let summaryResult: HarnessEvaluateOutput
      try {
        summaryResult = await invokeWorkflowAssistantCoding(
          {
            message: buildChangeSummaryMessage(opts.request, baseline, authored, opts.offer),
            workflow: authored as unknown as Record<string, unknown>,
            model: input.model,
            classifiedIntent,
            conversationSummary: input.conversationSummary,
            runContext: input.runContext,
            probeContext: opts.probe,
          },
          { ...ctx, config: summaryConfig }
        )
      } catch {
        const fallback =
          opts.offer === "probe"
            ? tryBuildProbeOfferReply(baseline, authored)
            : tryBuildChangeSummaryReply(baseline, authored)
        summaryResult = {
          artifact: fallback,
          raw: "",
          trace: {
            harness: BROWSER_CODING_HARNESS_ID,
            provider: ctx.uses,
            outputSchema: ECP_HARNESS_REPLY_SCHEMA,
          },
        }
      }

      let reply = isHarnessReplyArtifact(summaryResult.artifact)
        ? opts.offer === "probe"
          ? ensureOfferProbe(summaryResult.artifact)
          : ensureOfferRun(summaryResult.artifact)
        : opts.offer === "probe"
          ? tryBuildProbeOfferReply(baseline, authored)
          : tryBuildChangeSummaryReply(baseline, authored)

      const expectedAction =
        opts.offer === "probe"
          ? ECP_HARNESS_REPLY_ACTIONS.OFFER_PROBE
          : ECP_HARNESS_REPLY_ACTIONS.OFFER_RUN
      if (reply.suggestedAction !== expectedAction) {
        reply =
          opts.offer === "probe"
            ? tryBuildProbeOfferReply(baseline, authored)
            : tryBuildChangeSummaryReply(baseline, authored)
      }

      shots.push({
        ...shotFromTrace(
          WORKFLOW_CHANGE_SUMMARY_SHOT_TASK,
          "contextualized",
          summaryResult,
          ECP_HARNESS_REPLY_SCHEMA
        ),
        task: WORKFLOW_CHANGE_SUMMARY_SHOT_TASK,
      })

      return {
        artifact: reply,
        raw: summaryResult.raw,
        workflow: authored,
        ...(authoringResult?.validation ? { validation: authoringResult.validation } : {}),
        trace: summaryResult.trace,
      }
    }

    const failureReply = buildAuthoringFailureReply(authoringError)
    const failureResult = await invokeWorkflowAssistantCoding(
      {
        message: authoringError
          ? `Authoring failed: ${authoringError}. Explain briefly that the workflow could not be updated and ask the user to rephrase.`
          : "Authoring failed. Explain briefly that the workflow could not be updated and ask the user to rephrase.",
        model: input.model,
        classifiedIntent,
        conversationSummary: input.conversationSummary,
        runContext: input.runContext,
        workflow: input.manifest as Record<string, unknown> | undefined,
        probeContext: opts.probe,
      },
      { ...ctx, config: buildTaskConfig(HARNESS_TASKS.WORKFLOW_ASSISTANT) }
    ).catch(() => undefined)

    const artifact =
      failureResult && isHarnessReplyArtifact(failureResult.artifact)
        ? { ...failureResult.artifact, suggestedAction: undefined }
        : failureReply

    if (failureResult) {
      shots.push(
        shotFromTrace(
          HARNESS_TASKS.WORKFLOW_ASSISTANT,
          "contextualized",
          failureResult,
          ECP_HARNESS_REPLY_SCHEMA
        )
      )
    }

    return {
      artifact: {
        schema: ECP_HARNESS_REPLY_SCHEMA,
        answer: artifact.answer,
        ...(artifact.citations ? { citations: artifact.citations } : {}),
      },
      raw: failureResult?.raw ?? "",
      trace: failureResult?.trace ?? {
        harness: BROWSER_CODING_HARNESS_ID,
        provider: ctx.uses,
        outputSchema: ECP_HARNESS_REPLY_SCHEMA,
      },
    }
  }

  if (intentRoutesToClarify(classifiedIntent.intent)) {
    if (!probeContext || probeContext.options.length === 0) {
      const assistantResult = await invokeWorkflowAssistantCoding(
        {
          message:
            "The user is trying to clarify a probe selection, but no probe options are available. Ask them to run discovery first or restate which options they want.",
          model: input.model,
          classifiedIntent,
          conversationSummary: input.conversationSummary,
          runContext: input.runContext,
          workflow: input.manifest as Record<string, unknown> | undefined,
        },
        { ...ctx, config: buildTaskConfig(HARNESS_TASKS.WORKFLOW_ASSISTANT) }
      )
      shots.push(
        shotFromTrace(
          HARNESS_TASKS.WORKFLOW_ASSISTANT,
          "contextualized",
          assistantResult,
          ECP_HARNESS_REPLY_SCHEMA
        )
      )
      finalResult = assistantResult
    } else if (!messageSelectsProbeOptions(input.message, probeContext)) {
      const clarifyReply = tryBuildClarifyOptionsReply(probeContext)
      const assistantResult = await invokeWorkflowAssistantCoding(
        {
          message: `${input.message}\n\nList the probe options clearly and ask which ones to use. Do not invent options.`,
          model: input.model,
          classifiedIntent,
          conversationSummary: input.conversationSummary,
          runContext: input.runContext,
          workflow: input.manifest as Record<string, unknown> | undefined,
          probeContext,
        },
        { ...ctx, config: buildTaskConfig(HARNESS_TASKS.WORKFLOW_ASSISTANT) }
      ).catch(() => undefined)

      if (assistantResult) {
        shots.push(
          shotFromTrace(
            HARNESS_TASKS.WORKFLOW_ASSISTANT,
            "contextualized",
            assistantResult,
            ECP_HARNESS_REPLY_SCHEMA
          )
        )
      }

      finalResult = {
        artifact:
          assistantResult && isHarnessReplyArtifact(assistantResult.artifact)
            ? { ...assistantResult.artifact, suggestedAction: undefined }
            : clarifyReply,
        raw: assistantResult?.raw ?? "",
        trace: assistantResult?.trace ?? {
          harness: BROWSER_CODING_HARNESS_ID,
          provider: ctx.uses,
          outputSchema: ECP_HARNESS_REPLY_SCHEMA,
        },
      }
    } else {
      finalResult = await runAuthoringPath({
        request: input.message,
        forcePatch: true,
        offer: "run",
        probe: probeContext,
      })
    }
  } else if (intentRoutesToAuthoring(classifiedIntent.intent)) {
    const offer =
      classifiedIntent.intent === ECP_INTENT_VALUES.WORKFLOW_PROBE ? "probe" : "run"
    finalResult = await runAuthoringPath({
      request: input.message,
      forcePatch: classifiedIntent.intent === ECP_INTENT_VALUES.WORKFLOW_PATCH,
      offer,
      probe: probeContext,
    })
  } else {
    const assistantResult = await invokeWorkflowAssistantCoding(
      {
        message: input.message,
        runContext: input.runContext,
        workflow: input.manifest as Record<string, unknown> | undefined,
        model: input.model,
        classifiedIntent,
        conversationSummary: input.conversationSummary,
        probeContext,
        files: input.files,
      },
      { ...ctx, config: buildTaskConfig(HARNESS_TASKS.WORKFLOW_ASSISTANT) }
    )
    shots.push(
      shotFromTrace(
        HARNESS_TASKS.WORKFLOW_ASSISTANT,
        "contextualized",
        assistantResult,
        ECP_HARNESS_REPLY_SCHEMA
      )
    )
    finalResult = assistantResult
  }

  const trace: HarnessInvokeResult["trace"] = {
    ...finalResult.trace,
    harness: BROWSER_CODING_HARNESS_ID,
    orchestration: "multi-shot",
    classifiedIntent: {
      intent: classifiedIntent.intent,
      ...(classifiedIntent.topic ? { topic: classifiedIntent.topic } : {}),
      ...(classifiedIntent.summary ? { summary: classifiedIntent.summary } : {}),
    },
    shots,
  }

  return {
    artifact: finalResult.artifact,
    raw: finalResult.raw,
    ...(finalResult.validation ? { validation: finalResult.validation } : {}),
    ...(finalResult.workflow !== undefined ? { workflow: finalResult.workflow } : {}),
    trace,
  }
}

export { chatResultAnswer, chatResultWorkflow, chatResultSuggestedAction }
