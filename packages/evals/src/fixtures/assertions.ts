import { expect } from "vitest"
import type { Ecp, Environment } from "@executioncontrolprotocol/core"
import { answerRedirectsToHarnessScope, jsonSchemaObjectProperties } from "@executioncontrolprotocol/core"
import {
  ECP_HARNESS_REPLY_SCHEMA,
  ECP_INTENT_SCHEMA,
  type EcpIntentValue,
  type HarnessInvokeResult,
  type HarnessReply,
  type InvokeResult,
  type StepNode,
  type WorkflowManifest,
} from "@executioncontrolprotocol/types"
import { OLLAMA_GEMMA_1B_EVAL } from "../profiles/ollama-gemma.js"
import { OLLAMA_QWEN_CODER_15B_EVAL } from "../profiles/ollama-qwen.js"

const JUDGE_ENABLED_PROFILE_IDS: Set<string> = new Set([
  OLLAMA_GEMMA_1B_EVAL.id,
  OLLAMA_QWEN_CODER_15B_EVAL.id,
])
import { getActiveEvalProvider } from "../profiles/eval-provider-context.js"
import type { EvalProviderProfile } from "../profiles/eval-provider.js"
import type { DeterministicAssertion, EvalCase, JudgeAssertion } from "./eval-case-schema.js"
import { isFlowEvalCase } from "./eval-case-schema.js"
import {
  isEvalDebugEnabled,
  logEvalAssertionMismatch,
} from "./eval-debug.js"
import { formatInvokeFailure } from "./harness-trace-format.js"

function caseLabel(caseRow: EvalCase, stepIndex?: number): string {
  return stepIndex === undefined ? `[${caseRow.id}]` : `[${caseRow.id} step ${stepIndex}]`
}

function formatInvokeFailureDetails(result: InvokeResult): string {
  if (isEvalDebugEnabled()) {
    return ` (${formatInvokeFailure(result)})`
  }
  const parts: string[] = []
  if (result.diagnostics?.length) {
    parts.push(
      `diagnostics: ${result.diagnostics.map((d) => (d.path ? `${d.path}: ` : "") + d.message).join("; ")}`
    )
  }
  if (!result.success && result.result !== undefined) {
    const harness = result.result as HarnessInvokeResult
    if (harness.trace?.rawOutput) {
      parts.push(`rawOutput: ${String(harness.trace.rawOutput).slice(0, 500)}`)
    }
    const validationErrors = harness.validation?.errors
    if (validationErrors?.length) {
      parts.push(
        `validation: ${validationErrors.map((e) => (e.path ? `${e.path}: ` : "") + e.message).join("; ")}`
      )
    }
  }
  return parts.length > 0 ? ` (${parts.join(" | ")})` : ""
}

function findStep(workflow: WorkflowManifest, stepId: string): StepNode | undefined {
  const node = workflow.steps?.find((s) => s.type === "step" && s.id === stepId)
  return node?.type === "step" ? node : undefined
}

function workflowIoPropertyNames(
  workflow: WorkflowManifest,
  field: "accepts" | "returns"
): string[] {
  const schema = workflow.workflow?.[field] as Record<string, unknown> | undefined
  return jsonSchemaObjectProperties(schema).map((p) => p.name)
}

function isWorkflowIoAbsent(workflow: WorkflowManifest, field: "accepts" | "returns"): boolean {
  const schema = workflow.workflow?.[field] as Record<string, unknown> | undefined
  if (!schema) return true
  return workflowIoPropertyNames(workflow, field).length === 0
}

function stepUsesAcceptsRef(workflow: WorkflowManifest, property: string): boolean {
  const targetRef = `state.${property}`
  for (const node of workflow.steps ?? []) {
    if (node.type !== undefined && node.type !== "step") continue
    const input = (node as StepNode).input as Record<string, unknown> | undefined
    if (!input) continue
    for (const value of Object.values(input)) {
      if (
        value !== null &&
        typeof value === "object" &&
        "$ref" in (value as object) &&
        (value as { $ref: string }).$ref === targetRef
      ) {
        return true
      }
    }
  }
  return false
}

function returnsMapsToAsKey(
  workflow: WorkflowManifest,
  property: string,
  asKey: string
): boolean {
  const returnsProps = workflowIoPropertyNames(workflow, "returns")
  if (!returnsProps.includes(property)) return false
  return (workflow.steps ?? []).some(
    (s) => s.type === "step" && (s as StepNode).as === asKey
  )
}

/**
 * Run deterministic assertions against a harness invoke result.
 * @category Evals
 */
export async function assertDeterministic(
  caseRow: EvalCase,
  result: InvokeResult,
  assertions: DeterministicAssertion[],
  options: {
    ecp: Ecp
    env: Environment
    descriptorExtensionIds?: string[]
    descriptorCapabilityIds?: string[]
    stepIndex?: number
  }
): Promise<HarnessInvokeResult> {
  const label = caseLabel(caseRow, options.stepIndex)

  const debugDescribeOpts = {
    stepIndex: options.stepIndex,
    descriptorExtensionIds: options.descriptorExtensionIds,
    descriptorCapabilityIds: options.descriptorCapabilityIds,
    describeExtensions: async () =>
      (await options.ecp.describe()).extensions?.map((e) => e.id) ?? [],
    describeCapabilities: async () =>
      (await options.ecp.describe()).capabilities?.map((c) => c.id) ?? [],
  }

  for (const assertion of assertions) {
    const harnessOutputForDebug = result.success
      ? (result.result as HarnessInvokeResult)
      : (result.result as HarnessInvokeResult | undefined)

    try {
    if (assertion.kind === "invokeSuccess") {
      expect(
        result.success,
        `${label} invoke should succeed${formatInvokeFailureDetails(result)}`
      ).toBe(true)
      continue
    }
    if (!result.success) {
      throw new Error(`${label} expected success before ${assertion.kind}`)
    }
    const harnessOutput = result.result as HarnessInvokeResult

    switch (assertion.kind) {
      case "artifactSchema":
        expect(
          (harnessOutput.artifact as { schema?: string })?.schema,
          `${label} artifact schema`
        ).toBe(assertion.value)
        break
      case "validationValid":
        expect(harnessOutput.validation?.valid ?? true, `${label} validation`).toBe(true)
        break
      case "intent": {
        const artifact = harnessOutput.artifact as { schema?: string; intent?: EcpIntentValue }
        expect(artifact.schema, `${label} intent schema`).toBe(ECP_INTENT_SCHEMA)
        expect(artifact.intent, `${label} intent value`).toBe(assertion.value)
        break
      }
      case "replySchema": {
        const artifact = harnessOutput.artifact as HarnessReply
        expect(artifact.schema, `${label} reply schema`).toBe(ECP_HARNESS_REPLY_SCHEMA)
        break
      }
      case "replyAction": {
        const artifact = harnessOutput.artifact as HarnessReply
        expect(artifact.suggestedAction, `${label} reply action`).toBe(assertion.value)
        break
      }
      case "replyActionAbsent": {
        const artifact = harnessOutput.artifact as HarnessReply
        expect(artifact.suggestedAction, `${label} reply action absent`).toBeUndefined()
        break
      }
      case "stepUses": {
        const wf = harnessOutput.artifact as WorkflowManifest
        const uses =
          wf.steps
            ?.map((s) => ("uses" in s && typeof s.uses === "string" ? s.uses : undefined))
            .filter((u): u is string => u !== undefined) ?? []
        expect(uses, `${label} step uses`).toContain(assertion.capabilityId)
        break
      }
      case "stepCount": {
        const wf = harnessOutput.artifact as WorkflowManifest
        const count = wf.steps?.length ?? 0
        if (assertion.exact !== undefined) {
          expect(count, `${label} step count`).toBe(assertion.exact)
        } else {
          expect(count, `${label} step count`).toBeGreaterThanOrEqual(assertion.min ?? 1)
        }
        break
      }
      case "stepLabel": {
        const wf = harnessOutput.artifact as WorkflowManifest
        const step = findStep(wf, assertion.stepId)
        expect(step?.label, `${label} step label`).toBe(assertion.value)
        break
      }
      case "workflowLabel": {
        const wf = harnessOutput.artifact as WorkflowManifest
        expect(wf.workflow?.label, `${label} workflow label`).toBe(assertion.value)
        break
      }
      case "stepRemoved": {
        const wf = harnessOutput.artifact as WorkflowManifest
        const step = wf.steps?.find((s) => s.type === "step" && s.id === assertion.stepId)
        expect(step, `${label} removed step`).toBeUndefined()
        break
      }
      case "inputRefPresent": {
        const wf = harnessOutput.artifact as WorkflowManifest
        const step = findStep(wf, assertion.stepId)
        const input = step?.input as Record<string, unknown> | undefined
        const hasRef =
          input !== undefined &&
          Object.values(input).some(
            (v) => v !== null && typeof v === "object" && "$ref" in (v as object)
          )
        expect(hasRef, `${label} input $ref`).toBe(true)
        break
      }
      case "stepOrder": {
        const wf = harnessOutput.artifact as WorkflowManifest
        const order =
          wf.steps
            ?.filter((s) => s.type === "step" || s.type === undefined)
            .map((s) => s.id) ?? []
        expect(order, `${label} step order`).toEqual(assertion.stepIds)
        break
      }
      case "citationStepId": {
        const artifact = harnessOutput.artifact as HarnessReply
        const cited = artifact.citations?.some(
          (c) => c.kind === "step" && c.id === assertion.value
        )
        expect(cited || artifact.answer.includes(assertion.value), `${label} citation`).toBe(true)
        break
      }
      case "answerContains": {
        const artifact = harnessOutput.artifact as HarnessReply
        expect(artifact.answer.toLowerCase(), `${label} answer text`).toContain(
          assertion.text.toLowerCase()
        )
        break
      }
      case "answerMaxLength": {
        const artifact = harnessOutput.artifact as HarnessReply
        expect(
          artifact.answer.length,
          `${label} answer length`
        ).toBeLessThanOrEqual(assertion.max)
        break
      }
      case "rawNotContains": {
        const rawOutput = harnessOutput.trace?.rawOutput
        expect(typeof rawOutput, `${label} raw output present`).toBe("string")
        expect(String(rawOutput), `${label} raw output`).not.toContain(assertion.text)
        break
      }
      case "answerRedirectsToScope": {
        const artifact = harnessOutput.artifact as HarnessReply
        expect(
          answerRedirectsToHarnessScope(artifact.answer),
          `${label} answer redirects to harness scope`
        ).toBe(true)
        break
      }
      case "descriptorListsExtensions": {
        const ids =
          options.descriptorExtensionIds ??
          (await options.ecp.describe()).extensions?.map((e) => e.id) ??
          []
        for (const id of assertion.ids) {
          expect(ids, `${label} descriptor extensions`).toContain(id)
        }
        break
      }
      case "descriptorListsCapabilities": {
        const ids =
          options.descriptorCapabilityIds ??
          (await options.ecp.describe()).capabilities?.map((c) => c.id) ??
          []
        for (const id of assertion.ids) {
          expect(ids, `${label} descriptor capabilities`).toContain(id)
        }
        break
      }
      case "classifiedIntent": {
        const classified = harnessOutput.trace?.classifiedIntent
        expect(classified?.intent, `${label} classified intent`).toBe(assertion.value)
        break
      }
      case "classifiedTopic": {
        const topic = harnessOutput.trace?.classifiedIntent?.topic ?? ""
        expect(
          topic.toLowerCase(),
          `${label} classified topic`
        ).toContain(assertion.contains.toLowerCase())
        break
      }
      case "shotCount": {
        const count = harnessOutput.trace?.shots?.length ?? 0
        expect(count, `${label} shot count`).toBe(assertion.value)
        break
      }
      case "promptPhase": {
        const shot = harnessOutput.trace?.shots?.[assertion.shotIndex]
        expect(shot?.promptPhase, `${label} prompt phase shot ${assertion.shotIndex}`).toBe(
          assertion.value
        )
        break
      }
      case "shotTask": {
        const shot = harnessOutput.trace?.shots?.[assertion.shotIndex]
        expect(shot?.task, `${label} shot task ${assertion.shotIndex}`).toBe(assertion.task)
        break
      }
      case "sidecarWorkflowSchema": {
        const sidecar = harnessOutput.workflow as WorkflowManifest | undefined
        expect(sidecar?.schema, `${label} sidecar workflow schema`).toBe(assertion.value)
        break
      }
      case "sidecarStepUses": {
        const sidecar = harnessOutput.workflow as WorkflowManifest | undefined
        const uses =
          sidecar?.steps
            ?.map((s) => ("uses" in s && typeof s.uses === "string" ? s.uses : undefined))
            .filter((u): u is string => u !== undefined) ?? []
        expect(uses, `${label} sidecar step uses`).toContain(assertion.capabilityId)
        break
      }
      case "sidecarStepLabel": {
        const sidecar = harnessOutput.workflow as WorkflowManifest | undefined
        expect(sidecar, `${label} sidecar workflow present`).toBeDefined()
        const step = findStep(sidecar!, assertion.stepId)
        expect(step?.label, `${label} sidecar step label`).toBe(assertion.value)
        break
      }
      case "workflowAcceptsHasProperties": {
        const wf = harnessOutput.artifact as WorkflowManifest
        const names = workflowIoPropertyNames(wf, "accepts")
        for (const prop of assertion.properties) {
          expect(names, `${label} workflow.accepts properties`).toContain(prop)
        }
        break
      }
      case "workflowReturnsHasProperties": {
        const wf = harnessOutput.artifact as WorkflowManifest
        const names = workflowIoPropertyNames(wf, "returns")
        for (const prop of assertion.properties) {
          expect(names, `${label} workflow.returns properties`).toContain(prop)
        }
        break
      }
      case "workflowAcceptsAbsent": {
        const wf = harnessOutput.artifact as WorkflowManifest
        expect(isWorkflowIoAbsent(wf, "accepts"), `${label} workflow.accepts absent`).toBe(true)
        break
      }
      case "workflowReturnsAbsent": {
        const wf = harnessOutput.artifact as WorkflowManifest
        expect(isWorkflowIoAbsent(wf, "returns"), `${label} workflow.returns absent`).toBe(true)
        break
      }
      case "workflowAcceptsRefUsed": {
        const wf = harnessOutput.artifact as WorkflowManifest
        expect(
          stepUsesAcceptsRef(wf, assertion.property),
          `${label} accepts ref for ${assertion.property}`
        ).toBe(true)
        break
      }
      case "workflowReturnsMapsAs": {
        const wf = harnessOutput.artifact as WorkflowManifest
        expect(
          returnsMapsToAsKey(wf, assertion.property, assertion.asKey),
          `${label} returns maps to as key`
        ).toBe(true)
        break
      }
      default:
        break
    }
    } catch (e) {
      await logEvalAssertionMismatch(caseRow, assertion, harnessOutputForDebug, {
        ...debugDescribeOpts,
        errorMessage: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  if (!result.success) {
    throw new Error(`${label} invoke failed`)
  }
  return result.result as HarnessInvokeResult
}

/**
 * Run LLM judge via @executioncontrolprotocol/ollama.evaluate when enabled.
 * @category Evals
 */
export async function assertJudge(
  caseRow: EvalCase,
  harnessOutput: HarnessInvokeResult,
  judge: JudgeAssertion,
  ecp: Ecp,
  stepIndex?: number
): Promise<void> {
  if (!judge.enabled) return
  const provider = getActiveEvalProvider()
  if (!JUDGE_ENABLED_PROFILE_IDS.has(provider.id)) {
    return
  }
  const label = caseLabel(caseRow, stepIndex)
  let approved = false
  let judgeDetail = ""
  try {
    const evalInvoke = await ecp
      .invoke("@executioncontrolprotocol/ollama.evaluate")
      .with({
        artifact: harnessOutput.artifact,
        goal: judge.goal ?? `Eval case ${caseRow.id}`,
        criteria: judge.rubric,
        classifiedIntent:
          judge.classifiedIntent ?? harnessOutput.trace?.classifiedIntent?.intent,
      })
      .process()
    if (!evalInvoke.success) {
      const diag = evalInvoke.diagnostics?.map((d) => d.message).join("; ")
      judgeDetail = diag || "evaluate invoke failed"
    } else {
      approved = (evalInvoke.result as { approved?: boolean }).approved ?? false
      if (!approved) {
        judgeDetail = "evaluate returned approved=false"
      }
    }
  } catch (err) {
    judgeDetail = err instanceof Error ? err.message : String(err)
  }
  if (judge.requireApproved) {
    expect(
      approved,
      judgeDetail ? `${label} judge approved (${judgeDetail})` : `${label} judge approved`
    ).toBe(true)
  }
}

/** Whether judge-only mode skips deterministic checks. @category Evals */
export function isJudgeOnly(judge: JudgeAssertion): boolean {
  return judge.enabled === true && judge.only === true
}

/** @category Evals */
export function assertNotFlowCase(caseRow: EvalCase): asserts caseRow is Exclude<EvalCase, { suite: "flow" }> {
  if (isFlowEvalCase(caseRow)) {
    throw new Error(`Expected single-harness case, got flow: ${caseRow.id}`)
  }
}

/** Resolve model id for invoke; omit when the active provider has no model tag. @category Evals */
export function resolveEvalModel(
  caseRow: EvalCase,
  provider: EvalProviderProfile = getActiveEvalProvider()
): string | undefined {
  if (caseRow.model !== undefined && caseRow.model !== "default") {
    return caseRow.model
  }
  return provider.model
}
