import { z } from "zod"

/** Domain-agnostic selectable option from a live probe. @category Harness */
export const probeOptionSchema = z.object({
  /** Stable id for refs/literals (layer id, field name, variant index, …). */
  id: z.string().min(1),
  /** Human label for chat. */
  label: z.string().min(1),
  /** Optional state path hint (e.g. manifest.layers.0.id). */
  path: z.string().optional(),
  /** Optional small metadata bag for adapters. */
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
})

/** Selectable probe option type. @category Harness */
export type ProbeOption = z.infer<typeof probeOptionSchema>

/**
 * Live discovery context for the probe → clarify → complete chat loop.
 * Domain tags select prompt flavor only; intents stay vendor-agnostic.
 * @category Harness
 */
export const probeContextSchema = z.object({
  /** Stable probe session id. */
  probeId: z.string().min(1),
  /** Domain tag for prompt flavor (e.g. photoshop-layers). */
  domain: z.string().min(1),
  /** Test-session cursor step id when applicable. */
  cursor: z.string().optional(),
  /** Workflow `.as` key holding discovery output. */
  stepAs: z.string().optional(),
  /** Short prompt-safe summary of what was discovered. */
  summary: z.string().min(1),
  /** Options the user can choose among. */
  options: z.array(probeOptionSchema),
})

/** Probe context type. @category Harness */
export type ProbeContext = z.infer<typeof probeContextSchema>

/** Well-known probe domain ids. @category Harness */
export const PROBE_CONTEXT_DOMAINS = {
  PHOTOSHOP_LAYERS: "photoshop-layers",
} as const
