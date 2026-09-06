import { ECP_INTENT_VALUES } from "@executioncontrolprotocol/types"
import { z } from "zod"

/** Eval suite identifiers. @category Evals */
export const EVAL_SUITE_VALUES = {
  WORKFLOW_CREATE: "workflow-create",
  WORKFLOW_PATCH: "workflow-patch",
  INTENT: "intent",
  ASSISTANT: "assistant",
  FLOW: "flow",
  CHAT: "chat",
} as const

/** Eval suite union. @category Evals */
export type EvalSuite = (typeof EVAL_SUITE_VALUES)[keyof typeof EVAL_SUITE_VALUES]

/** Harness id segment used in case files. @category Evals */
export const EVAL_HARNESS_NAMES = {
  WORKFLOW_AUTHORING: "workflow-authoring",
  INTENT_CLASSIFICATION: "intent-classification",
  WORKFLOW_ASSISTANT: "workflow-assistant",
  CHAT: "chat",
} as const

const deterministicAssertionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invokeSuccess") }),
  z.object({ kind: z.literal("artifactSchema"), value: z.string() }),
  z.object({ kind: z.literal("validationValid") }),
  z.object({ kind: z.literal("intent"), value: z.enum([
    ECP_INTENT_VALUES.FAQ,
    ECP_INTENT_VALUES.WORKFLOW_CREATE,
    ECP_INTENT_VALUES.WORKFLOW_PATCH,
    ECP_INTENT_VALUES.GENERAL,
  ]) }),
  z.object({ kind: z.literal("replySchema") }),
  z.object({ kind: z.literal("replyAction"), value: z.literal("offer-run") }),
  z.object({ kind: z.literal("replyActionAbsent") }),
  z.object({ kind: z.literal("stepUses"), capabilityId: z.string() }),
  z.object({ kind: z.literal("stepCount"), min: z.number().optional(), exact: z.number().optional() }),
  z.object({ kind: z.literal("stepLabel"), stepId: z.string(), value: z.string() }),
  z.object({ kind: z.literal("workflowLabel"), value: z.string() }),
  z.object({ kind: z.literal("stepRemoved"), stepId: z.string() }),
  z.object({ kind: z.literal("descriptorListsExtensions"), ids: z.array(z.string()) }),
  z.object({ kind: z.literal("descriptorListsCapabilities"), ids: z.array(z.string()) }),
  z.object({ kind: z.literal("citationStepId"), value: z.string() }),
  z.object({ kind: z.literal("answerContains"), text: z.string() }),
  z.object({ kind: z.literal("answerMaxLength"), max: z.number() }),
  z.object({ kind: z.literal("rawNotContains"), text: z.string() }),
  z.object({ kind: z.literal("answerRedirectsToScope") }),
  z.object({ kind: z.literal("inputRefPresent"), stepId: z.string() }),
  z.object({ kind: z.literal("stepOrder"), stepIds: z.array(z.string()).min(1) }),
  z.object({
    kind: z.literal("classifiedIntent"),
    value: z.enum([
      ECP_INTENT_VALUES.FAQ,
      ECP_INTENT_VALUES.WORKFLOW_CREATE,
      ECP_INTENT_VALUES.WORKFLOW_PATCH,
      ECP_INTENT_VALUES.GENERAL,
    ]),
  }),
  z.object({ kind: z.literal("classifiedTopic"), contains: z.string() }),
  z.object({ kind: z.literal("shotCount"), value: z.number() }),
  z.object({
    kind: z.literal("promptPhase"),
    shotIndex: z.number(),
    value: z.enum(["unfiltered", "contextualized"]),
  }),
  z.object({ kind: z.literal("shotTask"), shotIndex: z.number(), task: z.string() }),
  z.object({ kind: z.literal("sidecarWorkflowSchema"), value: z.string() }),
  z.object({ kind: z.literal("sidecarStepUses"), capabilityId: z.string() }),
  z.object({ kind: z.literal("sidecarStepLabel"), stepId: z.string(), value: z.string() }),
  z.object({ kind: z.literal("workflowAcceptsHasProperties"), properties: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal("workflowReturnsHasProperties"), properties: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal("workflowAcceptsAbsent") }),
  z.object({ kind: z.literal("workflowReturnsAbsent") }),
  z.object({ kind: z.literal("workflowAcceptsRefUsed"), property: z.string() }),
  z.object({
    kind: z.literal("workflowReturnsMapsAs"),
    property: z.string(),
    asKey: z.string(),
  }),
])

const judgeAssertionSchema = z.object({
  enabled: z.boolean(),
  goal: z.string().optional(),
  rubric: z.string().optional(),
  requireApproved: z.boolean().optional(),
  only: z.boolean().optional(),
  classifiedIntent: z
    .enum([
      ECP_INTENT_VALUES.FAQ,
      ECP_INTENT_VALUES.WORKFLOW_CREATE,
      ECP_INTENT_VALUES.WORKFLOW_PATCH,
      ECP_INTENT_VALUES.GENERAL,
    ])
    .optional(),
})

const assertionsSchema = z.object({
  deterministic: z.array(deterministicAssertionSchema).default([]),
  judge: judgeAssertionSchema.default({ enabled: false }),
})

const flowStepSchema = z.object({
  harness: z.enum([
    EVAL_HARNESS_NAMES.WORKFLOW_AUTHORING,
    EVAL_HARNESS_NAMES.INTENT_CLASSIFICATION,
    EVAL_HARNESS_NAMES.WORKFLOW_ASSISTANT,
    EVAL_HARNESS_NAMES.CHAT,
  ]),
  input: z.record(z.string(), z.unknown()),
  assertions: assertionsSchema,
})

/** Single-harness eval case from JSON fixtures. @category Evals */
export const singleEvalCaseSchema = z.object({
  id: z.string().min(1),
  suite: z.enum([
    EVAL_SUITE_VALUES.WORKFLOW_CREATE,
    EVAL_SUITE_VALUES.WORKFLOW_PATCH,
    EVAL_SUITE_VALUES.INTENT,
    EVAL_SUITE_VALUES.ASSISTANT,
    EVAL_SUITE_VALUES.CHAT,
  ]),
  title: z.string().optional(),
  harness: z.enum([
    EVAL_HARNESS_NAMES.WORKFLOW_AUTHORING,
    EVAL_HARNESS_NAMES.INTENT_CLASSIFICATION,
    EVAL_HARNESS_NAMES.WORKFLOW_ASSISTANT,
    EVAL_HARNESS_NAMES.CHAT,
  ]),
  skip: z.boolean().optional(),
  model: z.string().optional(),
  baselineWorkflow: z.string().optional(),
  input: z.record(z.string(), z.unknown()),
  assertions: assertionsSchema,
})

/** Multi-step flow eval case. @category Evals */
export const flowEvalCaseSchema = z.object({
  id: z.string().min(1),
  suite: z.literal(EVAL_SUITE_VALUES.FLOW),
  title: z.string().optional(),
  skip: z.boolean().optional(),
  model: z.string().optional(),
  steps: z.array(flowStepSchema).min(1),
})

/** Eval case union. @category Evals */
export const evalCaseSchema = z.union([singleEvalCaseSchema, flowEvalCaseSchema])

/** Single-harness eval case type. @category Evals */
export type SingleEvalCase = z.infer<typeof singleEvalCaseSchema>

/** Flow eval case type. @category Evals */
export type FlowEvalCase = z.infer<typeof flowEvalCaseSchema>

/** Eval case type. @category Evals */
export type EvalCase = z.infer<typeof evalCaseSchema>

/** Deterministic assertion type. @category Evals */
export type DeterministicAssertion = z.infer<typeof deterministicAssertionSchema>

/** Judge config type. @category Evals */
export type JudgeAssertion = z.infer<typeof judgeAssertionSchema>

/** @category Evals */
export function isFlowEvalCase(caseRow: EvalCase): caseRow is FlowEvalCase {
  return caseRow.suite === EVAL_SUITE_VALUES.FLOW
}
