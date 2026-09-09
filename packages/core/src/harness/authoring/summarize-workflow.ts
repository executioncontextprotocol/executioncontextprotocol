import type { StepNode, WorkflowManifest } from "@executioncontrolprotocol/types"
import { jsonSchemaObjectProperties } from "../../schema/json-schema.js"

function formatInputValueEql(value: unknown): string {
  if (typeof value === "string") return `"${value.replace(/"/g, '\\"')}"`
  return JSON.stringify(value)
}

function stepInputWithLines(step: StepNode): string[] {
  const input = step.input as Record<string, unknown> | undefined
  if (!input || Object.keys(input).length === 0) return []
  const lines: string[] = []
  for (const [key, val] of Object.entries(input)) {
    if (val !== null && typeof val === "object" && "$ref" in (val as object)) {
      const ref = (val as { $ref: string }).$ref.replace(/^state\./, "")
      lines.push(`  WITH ${key} = REF ${ref}`)
    } else {
      lines.push(`  WITH ${key} = ${formatInputValueEql(val)}`)
    }
  }
  return lines
}

/** Compact workflow step row for model prompts. @category Harness */
export interface CompactWorkflowStepRow {
  /** Step id. */
  id: string
  /** Capability id. */
  uses: string
  /** Optional label. */
  label?: string
  /** Input field keys. */
  inputKeys: string[]
}

function workflowIoPropertyNames(
  manifest: WorkflowManifest,
  field: "accepts" | "returns"
): string[] {
  const schema = manifest.workflow?.[field] as Record<string, unknown> | undefined
  return jsonSchemaObjectProperties(schema).map((p) => p.name)
}

function formatIoTypeMapEqlLines(
  block: "ACCEPTS" | "RETURNS",
  manifest: WorkflowManifest
): string[] {
  const field = block === "ACCEPTS" ? "accepts" : "returns"
  const schema = manifest.workflow?.[field] as Record<string, unknown> | undefined
  const fields = jsonSchemaObjectProperties(schema)
  if (fields.length === 0) return []
  const prefix = block === "ACCEPTS" ? "WITH" : "OUT"
  const lines: string[] = [block]
  for (const prop of fields) {
    const type = prop.schema.type
    const typeLabel = typeof type === "string" ? type : "unknown"
    const suffix = prop.required ? "!" : ""
    lines.push(`  ${prefix} ${prop.name}:${typeLabel}${suffix}`)
  }
  return lines
}

/**
 * Summarize a workflow manifest for harness user prompts.
 * @category Harness
 */
export function summarizeWorkflowManifest(manifest: WorkflowManifest): {
  workflowId: string
  workflowLabel?: string
  steps: CompactWorkflowStepRow[]
  accepts: string[]
  returns: string[]
} {
  const workflow = manifest.workflow
  const steps: CompactWorkflowStepRow[] = []
  for (const node of manifest.steps ?? []) {
    if (node.type !== undefined && node.type !== "step") continue
    if (!("uses" in node) || typeof node.uses !== "string") continue
    const step = node as StepNode
    const input = step.input as Record<string, unknown> | undefined
    steps.push({
      id: step.id,
      uses: step.uses,
      label: step.label,
      inputKeys: input ? Object.keys(input) : [],
    })
  }
  return {
    workflowId: workflow?.id ?? "",
    workflowLabel: workflow?.label,
    steps,
    accepts: workflowIoPropertyNames(manifest, "accepts"),
    returns: workflowIoPropertyNames(manifest, "returns"),
  }
}

/**
 * Format workflow summary as prompt lines.
 * @category Harness
 */
export function formatWorkflowSummaryLines(
  manifest: WorkflowManifest,
  options?: { eql?: boolean; patchContext?: boolean }
): string[] {
  if (options?.eql) {
    return formatWorkflowSummaryEqlLines(manifest, options.patchContext ?? false)
  }

  const summary = summarizeWorkflowManifest(manifest)
  const lines = [
    `Workflow: ${summary.workflowId}${summary.workflowLabel ? ` (${summary.workflowLabel})` : ""}`,
    `Existing step ids (patch only these ids): ${summary.steps.map((s) => s.id).join(", ") || "none"}`,
  ]
  if (summary.accepts.length > 0) {
    lines.push(`Workflow accepts: ${summary.accepts.join(", ")}`)
  }
  if (summary.returns.length > 0) {
    lines.push(`Workflow returns: ${summary.returns.join(", ")}`)
  }
  lines.push("Steps:")
  for (const step of summary.steps) {
    const inputPart =
      step.inputKeys.length > 0 ? ` input keys: ${step.inputKeys.join(", ")}` : ""
    lines.push(
      `- ${step.id}: uses ${step.uses}${step.label ? ` label "${step.label}"` : ""}${inputPart}`
    )
  }
  return lines
}

/**
 * Format workflow as EQL-shaped lines for patch/create context in user prompts.
 * @category Harness
 */
export function formatWorkflowSummaryEqlLines(
  manifest: WorkflowManifest,
  patchContext: boolean
): string[] {
  const summary = summarizeWorkflowManifest(manifest)
  const stepIdList = summary.steps.map((s) => s.id).join(", ") || "none"
  const lines: string[] = [
    `Workflow id: ${summary.workflowId}${summary.workflowLabel ? ` (${summary.workflowLabel})` : ""}`,
  ]

  if (patchContext) {
    lines.push(
      `Existing step ids: ${stepIdList} (already in workflow — UPDATE STEP or DELETE STEP only, never ADD STEP with these ids).`,
      "Current steps (reference — do not re-output as STEP lines):"
    )
    for (const step of summary.steps) {
      const inputPart =
        step.inputKeys.length > 0 ? `; inputs: ${step.inputKeys.join(", ")}` : ""
      const labelPart = step.label ? `; label "${step.label}"` : ""
      lines.push(`- ${step.id}: USES ${step.uses}${labelPart}${inputPart}`)
    }
    if (summary.workflowLabel) {
      lines.push(
        `Workflow label: "${summary.workflowLabel}" (change with UPDATE WORKFLOW LABEL, not UPDATE STEP).`
      )
    }
    const accepts = workflowIoPropertyNames(manifest, "accepts")
    const returns = workflowIoPropertyNames(manifest, "returns")
    if (accepts.length > 0) {
      lines.push(`Workflow accepts: ${accepts.join(", ")} (change with UPDATE WORKFLOW ACCEPTS).`)
    }
    if (returns.length > 0) {
      lines.push(`Workflow returns: ${returns.join(", ")} (change with UPDATE WORKFLOW RETURNS).`)
    }
    lines.push(
      "",
      "Patch output rules:",
      "- PATCH WORKFLOW id must match the workflow id above.",
      "- Return PATCH WORKFLOW plus only UPDATE WORKFLOW / UPDATE STEP / ADD STEP / DELETE STEP / MOVE STEP operations.",
      "- Steps listed above already exist: UPDATE or DELETE them; do not ADD STEP with the same id.",
      "- ADD STEP keeps all existing steps unless you also DELETE STEP.",
      "- Remove all / clear / start fresh → DELETE STEP once for every listed step id (empty workflows are valid).",
      "- Do not output a full WORKFLOW document or re-list unchanged steps as STEP lines."
    )
    return lines
  }

  lines.push("Current workflow as EQL:")
  lines.push(...formatIoTypeMapEqlLines("ACCEPTS", manifest))
  lines.push(...formatIoTypeMapEqlLines("RETURNS", manifest))

  for (const node of manifest.steps ?? []) {
    if (node.type !== undefined && node.type !== "step") continue
    if (!("uses" in node) || typeof node.uses !== "string") continue
    const step = node as StepNode
    lines.push(`STEP ${step.id} USES ${step.uses}`)
    if (step.label) lines.push(`  LABEL "${step.label}"`)
    lines.push(...stepInputWithLines(step))
    if (step.as) lines.push(`  AS ${step.as}`)
    lines.push("")
  }

  return lines
}
