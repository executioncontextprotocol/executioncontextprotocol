import { z } from "zod"

/** Harness reply document schema id. @category Harness */
export const ECP_HARNESS_REPLY_SCHEMA = "@executioncontrolprotocol.harness.reply" as const

/** Citation kind in harness assistant replies. @category Harness */
export const ECP_HARNESS_REPLY_CITATION_KINDS = {
  STEP: "step",
  RUN: "run",
  EXTENSION: "extension",
  ERROR: "error",
} as const

/** Suggested UI action attached to a harness reply. @category Harness */
export const ECP_HARNESS_REPLY_ACTIONS = {
  OFFER_RUN: "offer-run",
  OFFER_PROBE: "offer-probe",
} as const

/** Suggested action literal union. @category Harness */
export type EcpHarnessReplyAction =
  (typeof ECP_HARNESS_REPLY_ACTIONS)[keyof typeof ECP_HARNESS_REPLY_ACTIONS]

/** Harness reply citation. @category Harness */
export const harnessReplyCitationSchema = z.object({
  kind: z.enum([
    ECP_HARNESS_REPLY_CITATION_KINDS.STEP,
    ECP_HARNESS_REPLY_CITATION_KINDS.RUN,
    ECP_HARNESS_REPLY_CITATION_KINDS.EXTENSION,
    ECP_HARNESS_REPLY_CITATION_KINDS.ERROR,
  ]),
  id: z.string().optional(),
  detail: z.string().optional(),
})

/** Structured harness assistant reply. @category Harness */
export const harnessReplySchema = z.object({
  schema: z.literal(ECP_HARNESS_REPLY_SCHEMA),
  /** Natural-language answer. */
  answer: z.string(),
  /** Optional structured citations. */
  citations: z.array(harnessReplyCitationSchema).optional(),
  /** Optional suggested follow-up action for the host UI. */
  suggestedAction: z
    .enum([ECP_HARNESS_REPLY_ACTIONS.OFFER_RUN, ECP_HARNESS_REPLY_ACTIONS.OFFER_PROBE])
    .optional(),
})

/** Structured harness assistant reply type. @category Harness */
export type HarnessReply = z.infer<typeof harnessReplySchema>
