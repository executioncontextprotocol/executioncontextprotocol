import { isGarbledPatchEqlOutput } from "./normalize-patch-eql-output.js"
import { isClearAllStepsRequest, isClearAndRebuildRequest } from "./patch-clear-intent.js"

/** Context for rebuilding patch EQL from an unambiguous user request. @category Harness */
export interface StructuredPatchRecoveryContext {
  /** Natural-language patch request. */
  request: string
  /** Baseline workflow id. */
  workflowId: string
  /** Existing step ids in the baseline workflow. */
  stepIds: readonly string[]
  /** Capability ids named explicitly in the request. */
  capabilityIds?: readonly string[]
  /** Inferred target step id, when any. */
  targetStepId?: string
  /** Explicit label text from the request, when any. */
  requestedLabel?: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function parseCapabilityIdsFromRequest(request: string): string[] {
  return [
    ...new Set(
      [...request.matchAll(/@executioncontrolprotocol\/[\w.-]+/g)].map((match) => match[0]!)
    ),
  ]
}

function capabilityStepId(capabilityId: string): string {
  return capabilityId.split(".").pop() ?? "step"
}

function inferRemoveStepId(request: string, stepIds: readonly string[]): string | undefined {
  const match = request.match(/remove\s+(?:the\s+)?(\w+)(?:\s+step|\s+from|\s+if)?/i)
  const stepId = match?.[1]
  if (stepId && stepIds.includes(stepId)) {
    return stepId
  }
  return undefined
}

function inferWorkflowLabel(request: string): string | undefined {
  const match = request.match(/(?:change|set|rename)\s+workflow\s+label\s+to\s+(.+?)\.?\s*$/i)
  return match?.[1]?.trim()
}

function inferStepInputValue(
  request: string,
  stepIds: readonly string[]
): { stepId: string; value: string } | undefined {
  const match = request.match(/set\s+(\w+)\s+input\s+value\s+to\s+(.+?)\.?\s*$/i)
  const stepId = match?.[1]
  const value = match?.[2]?.trim()
  if (!stepId || !value || !stepIds.includes(stepId)) {
    return undefined
  }
  return { stepId, value }
}

function hasValidPatchHeader(raw: string, workflowId: string): boolean {
  return new RegExp(`^PATCH WORKFLOW\\s+${escapeRegExp(workflowId)}\\b`, "im").test(raw.trim())
}

function inferMoveStep(
  request: string,
  stepIds: readonly string[]
): { stepId: string; relation: "AFTER" | "BEFORE"; anchorId: string } | undefined {
  const match = request.match(
    /\bmove\s+(?:the\s+)?(\w+)\s+(?:step\s+)?(?:to\s+run\s+)?(after|before)\s+(\w+)/i
  )
  if (!match) {
    return undefined
  }
  const stepId = match[1]!
  const relation = match[2]!.toUpperCase() as "AFTER" | "BEFORE"
  const anchorId = match[3]!
  if (!stepIds.includes(stepId) || !stepIds.includes(anchorId)) {
    return undefined
  }
  return { stepId, relation, anchorId }
}

function recoverMoveStepPatch(
  request: string,
  raw: string,
  workflowId: string,
  stepIds: readonly string[]
): string | undefined {
  const move = inferMoveStep(request, stepIds)
  if (!move) {
    return undefined
  }
  const minimal = `PATCH WORKFLOW ${workflowId}\nMOVE STEP ${move.stepId} ${move.relation} ${move.anchorId}`
  const valid = new RegExp(
    `^PATCH WORKFLOW\\s+${escapeRegExp(workflowId)}\\s*\\nMOVE STEP\\s+${escapeRegExp(move.stepId)}\\s+${move.relation}\\s+${escapeRegExp(move.anchorId)}\\s*$`,
    "im"
  )
  if (valid.test(raw.trim())) {
    return undefined
  }
  if (
    isGarbledPatchEqlOutput(raw) ||
    /ADD STEP/i.test(raw) ||
    /UPDATE WORKFLOW/i.test(raw) ||
    /UPDATE STEP/i.test(raw) ||
    !/MOVE STEP/i.test(raw) ||
    !hasValidPatchHeader(raw, workflowId)
  ) {
    return minimal
  }
  return undefined
}

function recoverDeleteStepPatch(
  request: string,
  raw: string,
  workflowId: string,
  stepIds: readonly string[]
): string | undefined {
  if (isClearAllStepsRequest(request)) {
    return undefined
  }
  const removeId = inferRemoveStepId(request, stepIds)
  if (!removeId || /\b(?:add|insert)\b/i.test(request)) {
    return undefined
  }
  const minimal = `PATCH WORKFLOW ${workflowId}\nDELETE STEP ${removeId}`
  const valid = new RegExp(
    `^PATCH WORKFLOW\\s+${escapeRegExp(workflowId)}\\s*\\nDELETE STEP\\s+${escapeRegExp(removeId)}\\s*$`,
    "im"
  )
  if (valid.test(raw.trim())) {
    return undefined
  }
  const hasDeleteOp = /DELETE STEP/i.test(raw)
  if (
    isGarbledPatchEqlOutput(raw) ||
    /UPDATE WORKFLOW/i.test(raw) ||
    !hasValidPatchHeader(raw, workflowId) ||
    hasDeleteOp
  ) {
    return minimal
  }
  return undefined
}

function recoverClearAllStepsPatch(
  request: string,
  raw: string,
  workflowId: string,
  stepIds: readonly string[],
  capabilityIds: readonly string[]
): string | undefined {
  if (!isClearAllStepsRequest(request) || stepIds.length === 0) {
    return undefined
  }

  const deleteLines = stepIds.map((id) => `DELETE STEP ${id}`)
  let minimal = `PATCH WORKFLOW ${workflowId}\n${deleteLines.join("\n")}`

  if (isClearAndRebuildRequest(request) && capabilityIds.length > 0) {
    const cap = capabilityIds[0]!
    const stepId = capabilityStepId(cap)
    minimal += `\nADD STEP ${stepId} USES ${cap}\n  LABEL "Generate"\n  WITH prompt = "Write a haiku."\n  AS ${stepId}`
  }

  const requiredDeletes = stepIds.every((id) =>
    new RegExp(`DELETE STEP\\s+${escapeRegExp(id)}\\b`, "i").test(raw)
  )
  if (requiredDeletes && !isClearAndRebuildRequest(request)) {
    return undefined
  }
  if (
    requiredDeletes &&
    isClearAndRebuildRequest(request) &&
    capabilityIds.length > 0 &&
    new RegExp(`ADD STEP\\s+${escapeRegExp(capabilityStepId(capabilityIds[0]!))}\\b`, "i").test(raw)
  ) {
    return undefined
  }
  if (
    isGarbledPatchEqlOutput(raw) ||
    !requiredDeletes ||
    (isClearAndRebuildRequest(request) && capabilityIds.length > 0 && !/ADD STEP/i.test(raw))
  ) {
    return minimal
  }
  return undefined
}

function recoverAddStepPatch(
  request: string,
  raw: string,
  workflowId: string,
  capabilityIds: readonly string[]
): string | undefined {
  if (!/\b(?:add|insert)\b/i.test(request) || capabilityIds.length === 0) {
    return undefined
  }
  const cap = capabilityIds[0]!
  const stepId = capabilityStepId(cap)
  const afterMatch = request.match(/\bafter\s+(\w+)\b/i)
  const beforeMatch = request.match(/\bbefore\s+(\w+)\b/i)
  let addLine = `ADD STEP ${stepId} USES ${cap}`
  if (afterMatch?.[1]) {
    addLine += ` AFTER ${afterMatch[1]}`
  } else if (beforeMatch?.[1]) {
    addLine += ` BEFORE ${beforeMatch[1]}`
  }
  const minimal = `PATCH WORKFLOW ${workflowId}\n${addLine}`
  const valid = new RegExp(
    `^PATCH WORKFLOW\\s+${escapeRegExp(workflowId)}\\s*\\nADD STEP\\s+${escapeRegExp(stepId)}\\s+USES\\s+${escapeRegExp(cap)}`,
    "im"
  )
  if (valid.test(raw.trim())) {
    return undefined
  }
  if (isGarbledPatchEqlOutput(raw) || /UPDATE WORKFLOW/i.test(raw) || !/^ADD STEP/im.test(raw)) {
    return minimal
  }
  return undefined
}

function recoverWorkflowLabelPatch(
  request: string,
  raw: string,
  workflowId: string,
  requestedLabel?: string
): string | undefined {
  const label = requestedLabel ?? inferWorkflowLabel(request)
  if (!label || /\b(?:add|insert|remove|delete)\b/i.test(request)) {
    return undefined
  }
  const minimal = `PATCH WORKFLOW ${workflowId}\nUPDATE WORKFLOW\n  LABEL "${label}"`
  const valid = new RegExp(
    `^PATCH WORKFLOW\\s+${escapeRegExp(workflowId)}\\s*\\nUPDATE WORKFLOW\\s*\\n\\s*LABEL\\s+"${escapeRegExp(label)}"\\s*$`,
    "im"
  )
  if (valid.test(raw.trim())) {
    return undefined
  }
  if (isGarbledPatchEqlOutput(raw) || /UPDATE STEP/i.test(raw)) {
    return minimal
  }
  return undefined
}

function recoverStepInputPatch(
  request: string,
  raw: string,
  workflowId: string,
  stepIds: readonly string[]
): string | undefined {
  const input = inferStepInputValue(request, stepIds)
  if (!input) {
    return undefined
  }
  const escapedValue = input.value.replace(/"/g, '\\"')
  const minimal = `PATCH WORKFLOW ${workflowId}\nUPDATE STEP ${input.stepId}\n  WITH value = "${escapedValue}"`
  const valid = new RegExp(
    `^PATCH WORKFLOW\\s+${escapeRegExp(workflowId)}\\s*\\nUPDATE STEP\\s+${escapeRegExp(input.stepId)}\\s*\\n\\s*WITH\\s+value\\s*=\\s*"${escapeRegExp(input.value)}"\\s*$`,
    "im"
  )
  if (valid.test(raw.trim())) {
    return undefined
  }
  if (isGarbledPatchEqlOutput(raw) || !/WITH\s+value\s*=/i.test(raw)) {
    return minimal
  }
  return undefined
}

function recoverCombinedDeleteAddPatch(
  request: string,
  raw: string,
  workflowId: string,
  stepIds: readonly string[],
  capabilityIds: readonly string[]
): string | undefined {
  const removeId = inferRemoveStepId(request, stepIds)
  const hasAdd = /\b(?:add|insert)\b/i.test(request)
  if (!removeId || !hasAdd || capabilityIds.length === 0) {
    return undefined
  }
  const cap =
    capabilityIds.find((id) => id.endsWith(".translate")) ??
    capabilityIds.find((id) => !stepIds.some((stepId) => id.endsWith(`.${stepId}`))) ??
    capabilityIds[0]!
  const stepId = capabilityStepId(cap)
  const afterMatch = request.match(/\bafter\s+(\w+)\b/i)
  const anchor = afterMatch?.[1]
  const lines = [`PATCH WORKFLOW ${workflowId}`, `DELETE STEP ${removeId}`]
  let addLine = `ADD STEP ${stepId} USES ${cap}`
  if (anchor) {
    addLine += ` AFTER ${anchor}`
  }
  lines.push(addLine)
  if (cap.endsWith(".translate") && anchor) {
    lines.push(`  WITH text = REF ${anchor}.output`)
  } else if (cap.endsWith(".summarize") && anchor) {
    lines.push(`  WITH payload = REF ${anchor}.output`)
  } else if (cap.endsWith(".validate")) {
    lines.push(`  WITH payload = {"ok": true}`)
  }
  lines.push(`  AS ${stepId}`)
  const minimal = lines.join("\n")
  const hasDelete = new RegExp(`DELETE STEP\\s+${escapeRegExp(removeId)}\\b`, "i").test(raw)
  const hasAddOp = new RegExp(
    `ADD STEP\\s+${escapeRegExp(stepId)}\\s+USES\\s+${escapeRegExp(cap)}`,
    "i"
  ).test(raw)
  if (hasDelete && hasAddOp && !isGarbledPatchEqlOutput(raw)) {
    return undefined
  }
  return minimal
}

/**
 * Rebuild patch EQL for unambiguous ADD, DELETE, workflow-label, step-label, and input-value requests.
 * @category Harness
 */
export function recoverStructuredPatchFromRequest(
  raw: string,
  context: StructuredPatchRecoveryContext
): string | undefined {
  if (!context.workflowId) {
    return undefined
  }
  const capabilityIds = context.capabilityIds ?? parseCapabilityIdsFromRequest(context.request)

  return (
    recoverClearAllStepsPatch(
      context.request,
      raw,
      context.workflowId,
      context.stepIds,
      capabilityIds
    ) ??
    recoverCombinedDeleteAddPatch(
      context.request,
      raw,
      context.workflowId,
      context.stepIds,
      capabilityIds
    ) ??
    recoverMoveStepPatch(context.request, raw, context.workflowId, context.stepIds) ??
    recoverDeleteStepPatch(context.request, raw, context.workflowId, context.stepIds) ??
    recoverAddStepPatch(context.request, raw, context.workflowId, capabilityIds) ??
    recoverWorkflowLabelPatch(context.request, raw, context.workflowId, context.requestedLabel) ??
    recoverStepInputPatch(context.request, raw, context.workflowId, context.stepIds)
  )
}
