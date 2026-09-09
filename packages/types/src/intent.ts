import { z } from "zod"

/** Chat / routing intent values. @category Harness */
export const ECP_INTENT_VALUES = {
  FAQ: "faq",
  WORKFLOW_CREATE: "workflow-create",
  WORKFLOW_PATCH: "workflow-patch",
  WORKFLOW_PROBE: "workflow-probe",
  WORKFLOW_CLARIFY: "workflow-clarify",
  GENERAL: "general",
} as const

/** Intent literal union. @category Harness */
export type EcpIntentValue = (typeof ECP_INTENT_VALUES)[keyof typeof ECP_INTENT_VALUES]

/** Intent classification document schema id. @category Harness */
export const ECP_INTENT_SCHEMA = "@executioncontrolprotocol.intent" as const

/** Classified user intent. @category Harness */
export const ecpIntentSchema = z.object({
  schema: z.literal(ECP_INTENT_SCHEMA),
  /** Classified routing intent. */
  intent: z.enum([
    ECP_INTENT_VALUES.FAQ,
    ECP_INTENT_VALUES.WORKFLOW_CREATE,
    ECP_INTENT_VALUES.WORKFLOW_PATCH,
    ECP_INTENT_VALUES.WORKFLOW_PROBE,
    ECP_INTENT_VALUES.WORKFLOW_CLARIFY,
    ECP_INTENT_VALUES.GENERAL,
  ]),
  /** Optional topic bucket for contextualized reinjection (e.g. patching, echo-failure). */
  topic: z.string().max(80).optional(),
  /** Optional one-line paraphrase of the user request. */
  summary: z.string().max(200).optional(),
})

/** Classified user intent type. @category Harness */
export type EcpIntent = z.infer<typeof ecpIntentSchema>
