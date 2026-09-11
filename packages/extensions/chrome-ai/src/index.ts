import {
  catalogExtension,
  capabilityFor,
  defineExtension,
  globalRegistry,
  type CapabilityContext,
  type Registry,
} from "@executioncontrolprotocol/core"
import {
  modelGenerateInputSchema,
  modelGenerateOutputSchema,
  type ModelGenerateInput,
} from "@executioncontrolprotocol/types"
import { z } from "zod"
import {
  assertModelReady,
  getModelInstallState,
  getPreferredCreateOptions,
  readAvailability,
  startModelDownload,
} from "./model-install.js"
import {
  createChromeLanguageModelSession,
  normalizePromptResponse,
  type ChromeLanguageModelApi,
} from "./prompt-session.js"
import { buildChromePromptWithContext } from "./format-model-context.js"

interface ChromeAiGlobal {
  LanguageModel?: ChromeLanguageModelApi
}

function chromeAi(): ChromeLanguageModelApi | undefined {
  return (globalThis as ChromeAiGlobal).LanguageModel
}

async function runChromePrompt(
  input: ModelGenerateInput,
  ctx: CapabilityContext
): Promise<{ text: string }> {
  if (input.files && input.files.length > 0) {
    throw new Error("@executioncontrolprotocol/chrome-ai.generate does not support files yet")
  }
  await assertModelReady()
  const model = chromeAi()
  if (!model?.create) {
    throw new Error("Chrome LanguageModel API is not available")
  }
  ctx.usage.increment({ modelCalls: 1 })
  const preferred = getPreferredCreateOptions()
  const sessionOptions = preferred.kind === "bare" ? {} : preferred.options
  const session = await createChromeLanguageModelSession(model, input.system, sessionOptions)
  const effectivePrompt = buildChromePromptWithContext(input.prompt, input.context)
  const response = await session.prompt(effectivePrompt)
  return { text: normalizePromptResponse(response) }
}

const InstallStateSchema = z.object({
  phase: z.enum(["idle", "checking", "downloading", "loading", "ready", "error"]),
  status: z
    .enum(["unsupported", "unavailable", "downloadable", "downloading", "available"])
    .optional(),
  loaded: z.number().optional(),
  total: z.number().optional(),
  error: z.string().optional(),
  hint: z.string().optional(),
})

/** Chrome built-in AI provider. @category Extensions */
export const chromeAiExtension = defineExtension("@executioncontrolprotocol", "chrome-ai")
  .withSupportedRuntimes(["@executioncontrolprotocol/browser"])
  .withCapabilities([
    capabilityFor("@executioncontrolprotocol/chrome-ai", "checkAvailability")
      .withInput(z.object({}))
      .withOutput(
        z.object({
          available: z.boolean(),
          supported: z.boolean(),
          status: z.string().optional(),
        })
      )
      .withHandler(async () => {
        const result = await readAvailability()
        return {
          available: result.available,
          supported: result.supported,
          status: result.status,
        }
      }),
    capabilityFor("@executioncontrolprotocol/chrome-ai", "startModelDownload")
      .withInput(z.object({}))
      .withOutput(z.object({ started: z.boolean() }))
      .withHandler(async () => startModelDownload()),
    capabilityFor("@executioncontrolprotocol/chrome-ai", "getModelInstallState")
      .withInput(z.object({}))
      .withOutput(InstallStateSchema)
      .withHandler(async () => getModelInstallState()),
    capabilityFor("@executioncontrolprotocol/chrome-ai", "generate")
      .withInput(modelGenerateInputSchema)
      .withOutput(modelGenerateOutputSchema)
      .withHandler(async (raw, ctx) =>
        runChromePrompt(modelGenerateInputSchema.parse(raw), ctx)
      ),
  ])
  .build()

catalogExtension(chromeAiExtension)

export type {
  ChromeAvailabilityStatus,
  ChromeModelInstallPhase,
  ChromeModelInstallState,
  ChromeModelStallCheckInput,
  PreferredChromeCreateOptions,
} from "./model-install.js"
export {
  assertModelReady,
  CHROME_MODEL_STALL_HINT,
  CHROME_MODEL_STALL_MS,
  getModelInstallState,
  getPreferredCreateOptions,
  isChromeModelInstallStalled,
  readAvailability,
  resetModelInstallState,
  startModelDownload,
} from "./model-install.js"

/** Register Chrome AI extension. @category Extensions */
export async function registerChromeAiExtension(registry: Registry = globalRegistry): Promise<void> {
  if (!registry.getExtension("@executioncontrolprotocol/chrome-ai")) {
    await registry.registerExtension(chromeAiExtension)
  }
}
