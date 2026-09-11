import {
  catalogExtension,
  capabilityFor,
  defineExtension,
  globalRegistry,
  BROWSER_RUNTIME_ID,
  NODE_RUNTIME_ID,
  type FileCapabilityContext,
  type Registry,
} from "@executioncontrolprotocol/core"
import {
  modelGenerateInputSchema,
  modelGenerateOutputSchema,
} from "@executioncontrolprotocol/types"
import { z } from "zod"
import {
  buildAnthropicUserContent,
  resolveAnthropicModel,
  resolveAnthropicSamplingOptions,
  ANTHROPIC_DEFAULT_MODEL,
} from "./messages.js"
import { resolveAnthropicApiKey } from "./resolve-api-key.js"

export {
  ANTHROPIC_GENERATE_DOCUMENT_MEDIA_TYPES,
  ANTHROPIC_GENERATE_IMAGE_MEDIA_TYPES,
  ANTHROPIC_GENERATE_MEDIA_TYPES,
  isAnthropicDocumentMediaType,
  isAnthropicGenerateMediaType,
  isAnthropicImageMediaType,
} from "./media-types.js"
export {
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  ANTHROPIC_DEFAULT_MODEL,
  buildAnthropicUserContent,
  resolveAnthropicModel,
  resolveAnthropicSamplingOptions,
} from "./messages.js"
export { resolveAnthropicApiKey } from "./resolve-api-key.js"

async function anthropicMessages(
  apiKey: string,
  body: Record<string, unknown>
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = ""
    try {
      detail = (await res.text()).slice(0, 500).trim()
    } catch {
      detail = ""
    }
    throw new Error(
      detail ? `Anthropic API error: ${res.status} (${detail})` : `Anthropic API error: ${res.status}`
    )
  }
  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>
  }
  return data.content.find((c) => c.type === "text")?.text ?? ""
}

/** Anthropic model provider. @category Extensions */
export const anthropicExtension = defineExtension("@executioncontrolprotocol", "anthropic")
  .withSupportedRuntimes([NODE_RUNTIME_ID, BROWSER_RUNTIME_ID])
  .withConfig({
    apiKey: z.string().optional(),
    defaultModel: z.string().optional(),
  })
  .withCapabilities([
    capabilityFor("@executioncontrolprotocol/anthropic", "generate")
      .withExecution("local")
      .withInput(modelGenerateInputSchema)
      .withOutput(modelGenerateOutputSchema)
      .withHandler(async (raw, ctx) => {
        const input = modelGenerateInputSchema.parse(raw)
        const cfg = (ctx as { extensionConfig?: Record<string, unknown> }).extensionConfig ?? {}
        const apiKey = resolveAnthropicApiKey(cfg)
        if (!apiKey) throw new Error("Anthropic API key required")
        const model = resolveAnthropicModel(input, cfg)
        const sampling = resolveAnthropicSamplingOptions(
          input.options as Record<string, unknown> | undefined
        )
        const systemParts: string[] = []
        if (input.system) systemParts.push(input.system)
        if (input.context !== undefined) {
          systemParts.push(JSON.stringify(input.context))
        }
        const content = await buildAnthropicUserContent(
          input.prompt,
          input.files,
          ctx as FileCapabilityContext
        )
        ctx.usage.increment({ modelCalls: 1 })
        const text = await anthropicMessages(apiKey, {
          model,
          ...sampling,
          ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
          messages: [{ role: "user", content }],
        })
        return { text }
      }),
    capabilityFor("@executioncontrolprotocol/anthropic", "evaluate")
      .withExecution("local")
      .withInput(
        z.object({
          artifact: z.unknown(),
          criteria: z.unknown().optional(),
          goal: z.string().optional(),
          classifiedIntent: z.string().optional(),
        })
      )
      .withOutput(z.object({ approved: z.boolean(), feedback: z.string().optional() }))
      .withHandler(async (input, ctx) => {
        const cfg = (ctx as { extensionConfig?: Record<string, unknown> }).extensionConfig ?? {}
        const apiKey = resolveAnthropicApiKey(cfg)
        if (!apiKey) return { approved: true, feedback: "skipped (no API key)" }
        const row = input as {
          artifact: unknown
          criteria?: unknown
          goal?: string
          classifiedIntent?: string
        }
        const prompt = [
          "You are an eval judge for ECP harness outputs.",
          'Reply with JSON only: {"approved":true,"feedback":"ok"} or {"approved":false,"feedback":"reason"}.',
          `Goal: ${row.goal ?? "quality check"}`,
          row.classifiedIntent ? `Classified intent: ${row.classifiedIntent}` : "",
          row.criteria ? `Rubric: ${JSON.stringify(row.criteria)}` : "",
          `Artifact: ${JSON.stringify(row.artifact)}`,
        ]
          .filter((line) => line.length > 0)
          .join("\n")
        ctx.usage.increment({ modelCalls: 1 })
        const content = await anthropicMessages(apiKey, {
          model: (cfg.defaultModel as string | undefined) ?? ANTHROPIC_DEFAULT_MODEL,
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        })
        try {
          return JSON.parse(content) as { approved: boolean; feedback?: string }
        } catch {
          return { approved: true, feedback: content }
        }
      }),
  ])
  .build()

catalogExtension(anthropicExtension)

/** Register Anthropic extension. @category Extensions */
export async function registerAnthropicExtension(
  registry: Registry = globalRegistry
): Promise<void> {
  if (!registry.getExtension("@executioncontrolprotocol/anthropic")) {
    await registry.registerExtension(anthropicExtension)
  }
}

export default anthropicExtension
