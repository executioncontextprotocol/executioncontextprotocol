import { z } from "zod"
import type { CapabilityId, NamespacedId } from "./schema.js"
import type { HarnessRepairAttempt } from "./harness-feedback.js"
import type { UsageSummary } from "./invoke.js"
import type { ValidationResult } from "./validation.js"

/** Reserved capability name for harness invocation. @category Harness */
export const ECP_HARNESS_CAPABILITY_NAME = "evaluate" as const

/** Harness validation error codes. @category Harness */
export const ECP_HARNESS_ERROR_CODES = {
  UNKNOWN_HARNESS: "UNKNOWN_HARNESS",
  UNKNOWN_HARNESS_PROVIDER: "UNKNOWN_HARNESS_PROVIDER",
  UNKNOWN_OUTPUT_FORMAT: "UNKNOWN_OUTPUT_FORMAT",
  HARNESS_PROVIDER_CONTRACT_MISMATCH: "HARNESS_PROVIDER_CONTRACT_MISMATCH",
  HARNESS_NOT_BOUND: "HARNESS_NOT_BOUND",
  HARNESS_EVALUATE_FAILED: "HARNESS_EVALUATE_FAILED",
} as const

/** Harness validation error code union. @category Harness */
export type EcpHarnessErrorCode =
  (typeof ECP_HARNESS_ERROR_CODES)[keyof typeof ECP_HARNESS_ERROR_CODES]

/** Core-cataloged formatter extension ids. @category Harness */
export const ECP_CORE_FORMATTER_IDS = {
  JSON: "@executioncontrolprotocol/format-json",
  FLUENT: "@executioncontrolprotocol/format-fluent",
} as const

/** Harness namespaced id. @category Harness */
export type HarnessId = NamespacedId

/** Harness evaluate capability id. @category Harness */
export type HarnessCapabilityId = `${HarnessId}.${typeof ECP_HARNESS_CAPABILITY_NAME}`

/** Build harness evaluate capability id. @category Harness */
export function harnessCapabilityId(harnessId: HarnessId | string): HarnessCapabilityId {
  const id = harnessId.startsWith("@") ? harnessId : (`@executioncontrolprotocol/${harnessId}` as NamespacedId)
  return `${id}.${ECP_HARNESS_CAPABILITY_NAME}` as HarnessCapabilityId
}

/** Prompt assembly phase for multi-shot harness orchestration. @category Harness */
export type HarnessPromptPhase = "unfiltered" | "contextualized"

/** Per-shot trace for multi-shot harness runs. @category Harness */
export interface HarnessShotTrace {
  /** Task id executed in this shot. */
  task: string
  /** Prompt phase for this shot. */
  promptPhase: HarnessPromptPhase
  /** Prompt sent to model when traced. */
  prompt?: string
  /** Raw model output when traced. */
  rawOutput?: string
  /** Per-attempt structured feedback when repair tracing is enabled. */
  repairAttempts?: HarnessRepairAttempt[]
  /** Target output schema for this shot. */
  outputSchema?: string
}

/** Trace metadata from a harness run. @category Harness */
export interface HarnessTrace {
  /** Harness id. */
  harness: HarnessId
  /** Provider capability used. */
  provider: CapabilityId
  /** Model id if provided. */
  model?: string
  /** Target output schema. */
  outputSchema?: string
  /** Formatter extension id. */
  outputFormat?: string
  /** Whether decode succeeded. */
  decodeSucceeded?: boolean
  /** Whether validation succeeded. */
  validationSucceeded?: boolean
  /** Prompt sent to model when traced. */
  prompt?: string
  /** Raw model output when traced. */
  rawOutput?: string
  /** Per-attempt structured feedback when repair tracing is enabled. */
  repairAttempts?: HarnessRepairAttempt[]
  /** Multi-shot orchestration mode when applicable. */
  orchestration?: "multi-shot"
  /** Classified intent from shot 1 when orchestration is multi-shot. */
  classifiedIntent?: {
    intent: string
    topic?: string
    summary?: string
  }
  /** Prompt phase for single-shot traces. */
  promptPhase?: HarnessPromptPhase
  /** Ordered shot traces for multi-shot runs. */
  shots?: HarnessShotTrace[]
}

/** Zod schema for standard harness evaluate handler return value. @category Harness */
export const harnessEvaluateOutputSchema = z.object({
  /** Parsed artifact after decode (and optional patch). */
  artifact: z.unknown(),
  /** Raw model text before decode. */
  raw: z.string(),
  /** Validation result when enabled. */
  validation: z.unknown().optional(),
  /**
   * Optional authored workflow sidecar when the primary artifact is a conversational reply
   * (multi-shot chat create/patch last shot).
   */
  workflow: z.unknown().optional(),
  /** Execution trace. */
  trace: z.custom<HarnessTrace>(
    (value) => typeof value === "object" && value !== null && "harness" in value
  ),
})

/** Inferred harness evaluate output from {@link harnessEvaluateOutputSchema}. @category Harness */
export type HarnessEvaluateOutput = z.infer<typeof harnessEvaluateOutputSchema>

/** Standard harness evaluate result envelope. @category Harness */
export interface HarnessInvokeResult<TArtifact = unknown> {
  /** Parsed artifact after decode (and optional patch). */
  artifact: TArtifact
  /** Raw model text before decode. */
  raw: string
  /** Validation result when enabled. */
  validation?: ValidationResult
  /**
   * Optional authored workflow sidecar when the primary artifact is a conversational reply
   * (multi-shot chat create/patch last shot).
   */
  workflow?: unknown
  /** Execution trace. */
  trace: HarnessTrace
  /** Provider usage summary. */
  usage?: UsageSummary
}
