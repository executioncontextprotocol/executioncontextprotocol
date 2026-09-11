import { z } from "zod"
import type { GenerateCapabilityInput, GenerateCapabilityOutput } from "./capabilities.js"
import { fileRefSchema } from "./file-ref.js"

/** Interface tag for harness-compatible model providers. @category Harness */
export const ECP_MODEL_GENERATE_INTERFACE = "@executioncontrolprotocol/model.generate" as const

/** Reserved capability name for model providers used by harnesses. @category Harness */
export const ECP_MODEL_CAPABILITY_NAME = "generate" as const

/** Response format hint for model generation. @category Harness */
export const ECP_MODEL_RESPONSE_FORMATS = {
  TEXT: "text",
  JSON: "json",
  TOON: "toon",
} as const

/** Model response format union. @category Harness */
export type EcpModelResponseFormat =
  (typeof ECP_MODEL_RESPONSE_FORMATS)[keyof typeof ECP_MODEL_RESPONSE_FORMATS]

/** Normalized model generate input. @category Harness */
export const modelGenerateInputSchema = z.object({
  /** User/model prompt body. */
  prompt: z.string(),
  /** System instruction. */
  system: z.string().optional(),
  /** Model override. */
  model: z.string().optional(),
  /** Optional provider context blob. */
  context: z.unknown().optional(),
  /** Output format hint for providers without native support. */
  responseFormat: z.enum(["text", "json", "toon", "eql"]).optional(),
  /** Provider-specific options (e.g. temperature, top_p for Ollama). */
  options: z.record(z.string(), z.unknown()).optional(),
  /**
   * Optional portable file refs for multimodal providers.
   * Providers that do not support files must reject a non-empty list.
   */
  files: z.array(fileRefSchema()).optional(),
})

/** Normalized model generate input type. @category Harness */
export type ModelGenerateInput = GenerateCapabilityInput &
  z.infer<typeof modelGenerateInputSchema>

/** Normalized model generate output. @category Harness */
export const modelGenerateOutputSchema = z.object({
  /** Generated text content. */
  text: z.string(),
})

/** Normalized model generate output type. @category Harness */
export type ModelGenerateOutput = GenerateCapabilityOutput &
  z.infer<typeof modelGenerateOutputSchema>
