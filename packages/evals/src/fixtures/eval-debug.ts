import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { HarnessInvokeResult, InvokeResult, WorkflowManifest } from "@executioncontrolprotocol/types"
import { jsonSchemaObjectProperties } from "@executioncontrolprotocol/core"
import type { DeterministicAssertion, EvalCase } from "./eval-case-schema.js"
import { isFlowEvalCase } from "./eval-case-schema.js"
import { formatHarnessTrace } from "./harness-trace-format.js"

export type EvalDebugMode = "off" | "all" | "failures"

/** Whether eval debug logging is enabled (`ECP_EVAL_DEBUG=1|true|all|failures`). */
export function evalDebugMode(): EvalDebugMode {
  const raw = process.env.ECP_EVAL_DEBUG?.trim().toLowerCase()
  if (!raw || raw === "0" || raw === "false" || raw === "off") return "off"
  if (raw === "all" || raw === "verbose") return "all"
  return "failures"
}

export function isEvalDebugEnabled(): boolean {
  return evalDebugMode() !== "off"
}

/** Whether eval tests log harness repair-loop and phase timing (`ECP_EVAL_DEBUG_TIMING=1`). @category Evals */
export function isEvalTimingDebugEnabled(): boolean {
  const raw = process.env.ECP_EVAL_DEBUG_TIMING?.trim().toLowerCase()
  return raw === "1" || raw === "true" || raw === "on" || raw === "all"
}

/** Log per-case eval wall-clock breakdown when {@link isEvalTimingDebugEnabled}. @category Evals */
export function logEvalCaseTiming(
  label: string,
  phases: Record<string, number | string | boolean | undefined>
): void {
  if (!isEvalTimingDebugEnabled()) return
  const lines = [`ECP_EVAL_DEBUG_TIMING case [${label}]`]
  for (const [key, value] of Object.entries(phases)) {
    if (value === undefined) continue
    lines.push(
      `  ${key}: ${typeof value === "number" ? `${Math.round(value)}ms` : String(value)}`
    )
  }
  console.warn(lines.join("\n"))
  writeNdjson({ type: "eval-case", label, ...phases })
}

function shouldLogCase(success: boolean): boolean {
  const mode = evalDebugMode()
  if (mode === "off") return false
  if (mode === "all") return true
  return !success
}

function debugLogFile(): string | undefined {
  const file = process.env.ECP_EVAL_DEBUG_FILE?.trim()
  return file && file.length > 0 ? file : undefined
}

function writeNdjson(entry: Record<string, unknown>): void {
  if (typeof window !== "undefined") return
  const file = debugLogFile()
  if (!file) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8")
  } catch {
    // best-effort file logging
  }
}

function caseLabel(caseRow: EvalCase, stepIndex?: number): string {
  return stepIndex === undefined ? caseRow.id : `${caseRow.id}#${stepIndex}`
}

function banner(title: string): string {
  return `\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`
}

function emitConsoleReport(title: string, sections: string[]): void {
  console.warn(banner(title), ...sections.map((s) => `\n${s}\n`))
}

function redactInput(input: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...input }
  if (typeof copy.manifest === "object" && copy.manifest !== null) {
    const m = copy.manifest as WorkflowManifest
    copy.manifest = {
      schema: m.schema,
      workflow: m.workflow,
      steps: m.steps?.map((s) =>
        s.type === "step"
          ? { id: s.id, uses: "uses" in s ? s.uses : undefined, label: s.label }
          : s
      ),
    }
  }
  return copy
}

/** Human-readable description of what a deterministic assertion checks. */
export function describeAssertionExpectation(assertion: DeterministicAssertion): string {
  switch (assertion.kind) {
    case "invokeSuccess":
      return "invoke succeeds (no harness diagnostics)"
    case "artifactSchema":
      return `artifact.schema === ${assertion.value}`
    case "validationValid":
      return "validation.valid === true"
    case "intent":
      return `intent === ${assertion.value}`
    case "replySchema":
      return "reply schema === @executioncontrolprotocol.harness.reply"
    case "stepUses":
      return `some step USES ${assertion.capabilityId}`
    case "stepCount":
      return assertion.exact !== undefined
        ? `step count === ${assertion.exact}`
        : `step count >= ${assertion.min ?? 1}`
    case "stepLabel":
      return `step ${assertion.stepId}.label === ${JSON.stringify(assertion.value)}`
    case "workflowLabel":
      return `workflow.label === ${JSON.stringify(assertion.value)}`
    case "stepRemoved":
      return `step ${assertion.stepId} is absent`
    case "inputRefPresent":
      return `step ${assertion.stepId} input contains a $ref`
    case "stepOrder":
      return `step order === [${assertion.stepIds.join(", ")}]`
    case "citationStepId":
      return `citation for step ${assertion.value} or answer mentions it`
    case "answerContains":
      return `answer contains ${JSON.stringify(assertion.text)} (case-insensitive)`
    case "descriptorListsExtensions":
      return `descriptor lists extensions: ${assertion.ids.join(", ")}`
    case "descriptorListsCapabilities":
      return `descriptor lists capabilities: ${assertion.ids.join(", ")}`
    case "workflowAcceptsHasProperties":
      return `workflow.accepts has properties: ${assertion.properties.join(", ")}`
    case "workflowReturnsHasProperties":
      return `workflow.returns has properties: ${assertion.properties.join(", ")}`
    case "workflowAcceptsAbsent":
      return "workflow.accepts is absent or empty"
    case "workflowReturnsAbsent":
      return "workflow.returns is absent or empty"
    case "workflowAcceptsRefUsed":
      return `some step input $ref targets state.${assertion.property}`
    case "workflowReturnsMapsAs":
      return `workflow.returns has property ${assertion.property} and step .as("${assertion.asKey}") exists`
    case "workflowReturnsPropertyType":
      return `workflow.returns.${assertion.property} has JSON Schema type ${assertion.type}`
    default:
      return JSON.stringify(assertion)
  }
}

function findStep(workflow: WorkflowManifest, stepId: string) {
  const node = workflow.steps?.find((s) => s.type === "step" && s.id === stepId)
  return node?.type === "step" ? node : undefined
}

function asWorkflowManifest(artifact: unknown): WorkflowManifest {
  return artifact as WorkflowManifest
}

/** Snapshot of actual values relevant to an assertion (for diff-style logs). */
export async function extractAssertionActual(
  assertion: DeterministicAssertion,
  harnessOutput: HarnessInvokeResult,
  options?: {
    descriptorExtensionIds?: string[]
    descriptorCapabilityIds?: string[]
    describeExtensions?: () => Promise<string[]>
    describeCapabilities?: () => Promise<string[]>
  }
): Promise<string> {
  const artifact = harnessOutput.artifact as Record<string, unknown> | undefined

  switch (assertion.kind) {
    case "invokeSuccess":
      return harnessOutput.trace?.decodeSucceeded === false
        ? "decode failed"
        : harnessOutput.validation?.valid === false
          ? `validation invalid: ${JSON.stringify(harnessOutput.validation?.errors)}`
          : "invoke envelope succeeded"
    case "artifactSchema":
      return `artifact.schema = ${String(artifact?.schema ?? "(missing)")}`
    case "validationValid":
      return `validation.valid = ${String(harnessOutput.validation?.valid ?? true)}`
    case "intent":
      return `intent = ${String((artifact as { intent?: string })?.intent ?? "(missing)")}`
    case "replySchema":
      return `schema = ${String((artifact as { schema?: string })?.schema ?? "(missing)")}`
    case "stepUses": {
      const wf = asWorkflowManifest(artifact)
      const uses =
        wf.steps
          ?.map((s) => ("uses" in s && typeof s.uses === "string" ? s.uses : undefined))
          .filter((u): u is string => u !== undefined) ?? []
      return `step USES list = [${uses.join(", ")}]`
    }
    case "stepCount": {
      const wf = asWorkflowManifest(artifact)
      const count = wf.steps?.length ?? 0
      return `step count = ${count}`
    }
    case "stepLabel": {
      const wf = asWorkflowManifest(artifact)
      const step = findStep(wf, assertion.stepId)
      return `step ${assertion.stepId}.label = ${JSON.stringify(step?.label ?? "(missing)")}`
    }
    case "workflowLabel": {
      const wf = asWorkflowManifest(artifact)
      return `workflow.label = ${JSON.stringify(wf.workflow?.label ?? "(missing)")}`
    }
    case "stepRemoved": {
      const wf = asWorkflowManifest(artifact)
      const step = wf.steps?.find((s) => s.type === "step" && s.id === assertion.stepId)
      return step ? `step ${assertion.stepId} still present` : `step ${assertion.stepId} removed`
    }
    case "inputRefPresent": {
      const wf = asWorkflowManifest(artifact)
      const step = findStep(wf, assertion.stepId)
      return `step ${assertion.stepId}.input = ${JSON.stringify(step?.input ?? null)}`
    }
    case "stepOrder": {
      const wf = asWorkflowManifest(artifact)
      const order =
        wf.steps
          ?.filter((s) => s.type === "step" || s.type === undefined)
          .map((s) => s.id) ?? []
      return `step order = [${order.join(", ")}]`
    }
    case "citationStepId": {
      const reply = artifact as { answer?: string; citations?: { kind: string; id?: string }[] }
      return `citations = ${JSON.stringify(reply.citations ?? [])}, answer preview = ${JSON.stringify((reply.answer ?? "").slice(0, 120))}`
    }
    case "answerContains": {
      const reply = artifact as { answer?: string }
      return `answer = ${JSON.stringify((reply.answer ?? "").slice(0, 200))}`
    }
    case "descriptorListsExtensions": {
      const ids =
        options?.descriptorExtensionIds ??
        (options?.describeExtensions ? await options.describeExtensions() : [])
      return `descriptor extension ids = [${ids.join(", ")}]`
    }
    case "descriptorListsCapabilities": {
      const ids =
        options?.descriptorCapabilityIds ??
        (options?.describeCapabilities ? await options.describeCapabilities() : [])
      return `descriptor capability ids = [${ids.join(", ")}]`
    }
    case "workflowAcceptsHasProperties": {
      const wf = asWorkflowManifest(artifact)
      const names = jsonSchemaObjectProperties(
        wf.workflow?.accepts as Record<string, unknown> | undefined
      ).map((p) => p.name)
      return `workflow.accepts properties = [${names.join(", ")}]`
    }
    case "workflowReturnsHasProperties": {
      const wf = asWorkflowManifest(artifact)
      const names = jsonSchemaObjectProperties(
        wf.workflow?.returns as Record<string, unknown> | undefined
      ).map((p) => p.name)
      return `workflow.returns properties = [${names.join(", ")}]`
    }
    case "workflowAcceptsAbsent": {
      const wf = asWorkflowManifest(artifact)
      const names = jsonSchemaObjectProperties(
        wf.workflow?.accepts as Record<string, unknown> | undefined
      ).map((p) => p.name)
      return names.length === 0 ? "workflow.accepts absent" : `workflow.accepts = ${JSON.stringify(wf.workflow?.accepts)}`
    }
    case "workflowReturnsAbsent": {
      const wf = asWorkflowManifest(artifact)
      const names = jsonSchemaObjectProperties(
        wf.workflow?.returns as Record<string, unknown> | undefined
      ).map((p) => p.name)
      return names.length === 0 ? "workflow.returns absent" : `workflow.returns = ${JSON.stringify(wf.workflow?.returns)}`
    }
    case "workflowAcceptsRefUsed": {
      const wf = asWorkflowManifest(artifact)
      const targetRef = `state.${assertion.property}`
      const refs: string[] = []
      for (const node of wf.steps ?? []) {
        if (node.type !== undefined && node.type !== "step") continue
        const input = node.input as Record<string, unknown> | undefined
        if (!input) continue
        for (const [key, value] of Object.entries(input)) {
          if (
            value !== null &&
            typeof value === "object" &&
            "$ref" in (value as object)
          ) {
            refs.push(`${node.id}.${key} -> ${(value as { $ref: string }).$ref}`)
          }
        }
      }
      const used = refs.some((r) => r.includes(targetRef))
      return used
        ? `accepts ref used via ${refs.filter((r) => r.includes(targetRef)).join("; ")}`
        : `no $ref to ${targetRef}; refs: [${refs.join(", ")}]`
    }
    case "workflowReturnsMapsAs": {
      const wf = asWorkflowManifest(artifact)
      const returnsProps = jsonSchemaObjectProperties(
        wf.workflow?.returns as Record<string, unknown> | undefined
      ).map((p) => p.name)
      const asKeys =
        wf.steps
          ?.filter((s) => s.type === "step")
          .map((s) => ("as" in s ? s.as : undefined))
          .filter((k): k is string => typeof k === "string") ?? []
      return `returns properties = [${returnsProps.join(", ")}], step as keys = [${asKeys.join(", ")}]`
    }
    case "workflowReturnsPropertyType": {
      const wf = asWorkflowManifest(artifact)
      const field = jsonSchemaObjectProperties(
        wf.workflow?.returns as Record<string, unknown> | undefined
      ).find((p) => p.name === assertion.property)
      const actualType =
        typeof field?.schema.type === "string" ? field.schema.type : field ? "unknown" : "missing"
      return `workflow.returns.${assertion.property} type = ${actualType}`
    }
    default:
      return JSON.stringify(artifact ?? null, null, 2).slice(0, 2000)
  }
}

export type EvalDebugInvokeContext = {
  caseRow: EvalCase
  stepIndex?: number
  harness: string
  input: Record<string, unknown>
  assertions: DeterministicAssertion[]
  judgeGoal?: string
}

/**
 * Log resolved case input and expected assertions before invoke.
 * @category Evals
 */
export function logEvalCaseContext(ctx: EvalDebugInvokeContext): void {
  if (!isEvalDebugEnabled() || evalDebugMode() !== "all") return

  const label = caseLabel(ctx.caseRow, ctx.stepIndex)
  const expected = ctx.assertions.map(
    (a, i) => `  ${i + 1}. [${a.kind}] ${describeAssertionExpectation(a)}`
  )

  const sections = [
    `case: ${label}`,
    `harness: ${ctx.harness}`,
    `input:\n${JSON.stringify(redactInput(ctx.input), null, 2)}`,
    `expected assertions:\n${expected.join("\n")}`,
    ...(ctx.judgeGoal ? [`judge goal: ${ctx.judgeGoal}`] : []),
  ]

  emitConsoleReport(`ECP_EVAL_DEBUG context [${label}]`, sections)
  writeNdjson({
    event: "eval-context",
    caseId: ctx.caseRow.id,
    stepIndex: ctx.stepIndex,
    harness: ctx.harness,
    input: redactInput(ctx.input),
    expectedAssertions: ctx.assertions,
    judgeGoal: ctx.judgeGoal,
    timestamp: Date.now(),
  })
}

/**
 * Log prompt, raw output, artifact summary, and expected vs actual after invoke.
 * @category Evals
 */
export function logEvalCaseInvoke(
  ctx: EvalDebugInvokeContext,
  result: InvokeResult
): void {
  const success = result.success
  if (!shouldLogCase(success)) return

  const label = caseLabel(ctx.caseRow, ctx.stepIndex)
  const harnessOutput = success
    ? (result.result as HarnessInvokeResult)
    : (result.result as HarnessInvokeResult | undefined)

  const sections: string[] = [
    `case: ${label}`,
    `harness: ${ctx.harness}`,
    `invoke success: ${success}`,
    `input:\n${JSON.stringify(redactInput(ctx.input), null, 2)}`,
  ]

  if (!success && result.diagnostics?.length) {
    sections.push(
      `diagnostics:\n${result.diagnostics.map((d) => `  - ${d.code ?? "?"}: ${d.message}`).join("\n")}`
    )
  }

  if (harnessOutput) {
    sections.push(formatHarnessTrace(harnessOutput))
    if (harnessOutput.artifact !== undefined) {
      sections.push(`artifact:\n${JSON.stringify(harnessOutput.artifact, null, 2).slice(0, 8000)}`)
    }
  }

  const expected = ctx.assertions.map(
    (a, i) => `  ${i + 1}. [${a.kind}] expect: ${describeAssertionExpectation(a)}`
  )
  sections.push(`expected assertions:\n${expected.join("\n")}`)

  emitConsoleReport(`ECP_EVAL_DEBUG invoke [${label}]`, sections)

  writeNdjson({
    event: "eval-invoke",
    caseId: ctx.caseRow.id,
    stepIndex: ctx.stepIndex,
    harness: ctx.harness,
    invokeSuccess: success,
    input: redactInput(ctx.input),
    diagnostics: result.diagnostics,
    trace: harnessOutput?.trace,
    validation: harnessOutput?.validation,
    artifact: harnessOutput?.artifact,
    expectedAssertions: ctx.assertions,
    timestamp: Date.now(),
  })
}

/**
 * Log a single assertion mismatch (call from catch around expect).
 * @category Evals
 */
export async function logEvalAssertionMismatch(
  caseRow: EvalCase,
  assertion: DeterministicAssertion,
  harnessOutput: HarnessInvokeResult | undefined,
  options: {
    stepIndex?: number
    errorMessage?: string
    descriptorExtensionIds?: string[]
    descriptorCapabilityIds?: string[]
    describeExtensions?: () => Promise<string[]>
    describeCapabilities?: () => Promise<string[]>
  }
): Promise<void> {
  if (!isEvalDebugEnabled()) return

  const label = caseLabel(caseRow, options.stepIndex)
  const actual = harnessOutput
    ? await extractAssertionActual(assertion, harnessOutput, options)
    : "(no harness output — invoke failed)"

  const sections = [
    `case: ${label}`,
    `assertion: [${assertion.kind}]`,
    `expected: ${describeAssertionExpectation(assertion)}`,
    `actual: ${actual}`,
    ...(options.errorMessage ? [`vitest: ${options.errorMessage}`] : []),
  ]

  if (harnessOutput) {
    sections.push(formatHarnessTrace(harnessOutput))
  }

  emitConsoleReport(`ECP_EVAL_DEBUG assertion mismatch [${label}]`, sections)

  writeNdjson({
    event: "eval-assertion-mismatch",
    caseId: caseRow.id,
    stepIndex: options.stepIndex,
    assertion,
    expected: describeAssertionExpectation(assertion),
    actual,
    errorMessage: options.errorMessage,
    trace: harnessOutput?.trace,
    artifact: harnessOutput?.artifact,
    timestamp: Date.now(),
  })
}

/** Collect harness + assertions from a case row for debug logging. */
export function evalDebugContextFromCase(
  caseRow: EvalCase,
  input: Record<string, unknown>,
  stepIndex?: number
): EvalDebugInvokeContext {
  if (isFlowEvalCase(caseRow) && stepIndex !== undefined) {
    const step = caseRow.steps[stepIndex]!
    return {
      caseRow,
      stepIndex,
      harness: step.harness,
      input,
      assertions: step.assertions.deterministic,
      judgeGoal: step.assertions.judge.goal,
    }
  }
  if (!isFlowEvalCase(caseRow)) {
    return {
      caseRow,
      harness: caseRow.harness,
      input,
      assertions: caseRow.assertions.deterministic,
      judgeGoal: caseRow.assertions.judge.goal,
    }
  }
  throw new Error(`evalDebugContextFromCase: flow case requires stepIndex`)
}
