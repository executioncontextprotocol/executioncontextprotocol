import type { RunResult, ValidationIssue, WorkflowManifest } from "@executioncontrolprotocol/types"
import {
  pickWorkflowReturns,
  validateAgainstJsonSchema,
} from "../schema/json-schema.js"

/**
 * Validate run `input` against `workflow.accepts`.
 * @category Schema
 */
export function validateWorkflowAcceptsInput(
  manifest: WorkflowManifest,
  input: Record<string, unknown> | undefined
): { ok: true } | { ok: false; message: string } {
  const result = validateAgainstJsonSchema(manifest.workflow.accepts, input ?? {})
  if (result.ok) return { ok: true }
  return { ok: false, message: `Workflow accepts validation failed: ${result.errors.join("; ")}` }
}

const RETURNS_VALIDATION_CODE = "WORKFLOW_RETURNS_INVALID"

/**
 * Attach `output` from `workflow.returns` and validate required properties.
 * Invalid returns mark the run failed and attach run-level diagnostics.
 * @category Schema
 */
export function applyWorkflowReturns(
  manifest: WorkflowManifest,
  result: RunResult,
  state: Record<string, unknown>
): RunResult {
  const output = pickWorkflowReturns(manifest.workflow.returns, state)
  if (output === undefined) return result

  const next: RunResult = { ...result, output }
  if (result.run.status !== "completed") return next

  const check = validateAgainstJsonSchema(manifest.workflow.returns, output)
  if (!check.ok) {
    const diagnostics: ValidationIssue[] = check.errors.map((message) => ({
      code: RETURNS_VALIDATION_CODE,
      message: `Workflow returns validation failed: ${message}`,
      severity: "error" as const,
      path: "workflow.returns",
    }))
    return {
      ...next,
      run: { ...result.run, status: "failed" },
      diagnostics,
    }
  }
  return next
}
