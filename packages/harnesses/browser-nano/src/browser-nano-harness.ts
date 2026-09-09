import {
  catalogHarness,
  defineHarness,
  type HarnessCapabilityContext,
} from "@executioncontrolprotocol/core"
import {
  ECP_MODEL_GENERATE_INTERFACE,
  harnessEvaluateOutputSchema,
  type HarnessEvaluateOutput,
} from "@executioncontrolprotocol/types"
import { z } from "zod"
import { getHarnessNanoConfig, HARNESS_TASKS, type HarnessTask } from "./harness-nano-config.js"
import { invokeIntentClassification } from "./intent-classification.js"
import { invokeMultiShotChat } from "./multi-shot-chat.js"
import { invokeWorkflowAssistant } from "./workflow-assistant.js"
import { invokeWorkflowAuthoring } from "./workflow-authoring.js"

const harnessInputSchema = z.discriminatedUnion("task", [
  z.object({
    task: z.literal(HARNESS_TASKS.INTENT_CLASSIFICATION),
    message: z.string(),
    model: z.string().optional(),
  }),
  z.object({
    task: z.literal(HARNESS_TASKS.WORKFLOW_AUTHORING),
    request: z.string(),
    manifest: z.unknown().optional(),
    model: z.string().optional(),
  }),
  z.object({
    task: z.literal(HARNESS_TASKS.WORKFLOW_ASSISTANT),
    message: z.string(),
    runContext: z.unknown().optional(),
    model: z.string().optional(),
  }),
  z.object({
    task: z.literal(HARNESS_TASKS.CHAT),
    message: z.string(),
    manifest: z.unknown().optional(),
    runContext: z.unknown().optional(),
    probeContext: z.unknown().optional(),
    conversationSummary: z.string().optional(),
    model: z.string().optional(),
  }),
])

/** Input for {@link BROWSER_NANO_HARNESS_ID} evaluate. @category Harness */
export type BrowserNanoHarnessInput = z.infer<typeof harnessInputSchema>

const harnessBindingSchema = z
  .object({
    repair: z.record(z.string(), z.unknown()).optional(),
    trace: z.record(z.string(), z.unknown()).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

function handlerContextForTask(
  task: HarnessTask,
  ctx: HarnessCapabilityContext<Record<string, unknown>>
): HarnessCapabilityContext<Record<string, unknown>> {
  const taskConfig = getHarnessNanoConfig(task) as Record<string, Record<string, unknown>>
  const envConfig = ctx.config as Record<string, Record<string, unknown> | undefined>
  return {
    ...ctx,
    config: {
      ...taskConfig,
      ...ctx.config,
      repair: { ...envConfig.repair, ...taskConfig.repair },
      trace: { ...envConfig.trace, ...taskConfig.trace },
      context: { ...envConfig.context, ...taskConfig.context },
    },
  }
}

const browserNanoHarnessDefinition = defineHarness("@executioncontrolprotocol", "harness-browser-nano")
  .withConfig(harnessBindingSchema)
  .withInput(harnessInputSchema)
  .withOutput(harnessEvaluateOutputSchema)
  .usesProviderInterface(ECP_MODEL_GENERATE_INTERFACE)
  .withHandler(async (input, ctx): Promise<HarnessEvaluateOutput> => {
    const taskCtx = handlerContextForTask(input.task, ctx)
    switch (input.task) {
      case HARNESS_TASKS.INTENT_CLASSIFICATION:
        return invokeIntentClassification(
          { message: input.message, model: input.model },
          taskCtx
        )
      case HARNESS_TASKS.WORKFLOW_AUTHORING:
        return invokeWorkflowAuthoring(
          { request: input.request, manifest: input.manifest, model: input.model },
          taskCtx
        )
      case HARNESS_TASKS.WORKFLOW_ASSISTANT:
        return invokeWorkflowAssistant(
          { message: input.message, runContext: input.runContext, model: input.model },
          taskCtx
        )
      case HARNESS_TASKS.CHAT:
        return invokeMultiShotChat(
          {
            message: input.message,
            manifest: input.manifest,
            runContext: input.runContext,
            probeContext: input.probeContext,
            conversationSummary: input.conversationSummary,
            model: input.model,
          },
          taskCtx
        )
      default: {
        const _exhaustive: never = input
        throw new Error(`Unknown harness task: ${String(_exhaustive)}`)
      }
    }
  })
  .build()

/** Register Browser Nano harness (`@executioncontrolprotocol/harness-browser-nano`). @category Harness */
export function registerBrowserNanoHarness(): void {
  catalogHarness(browserNanoHarnessDefinition)
}
