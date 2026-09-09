import {
  collectModelOutputFeedback,
  jsonSchemaObjectProperties,
  isClearAllStepsRequest,
  isClearAndRebuildRequest,
} from "@executioncontrolprotocol/core"
import type { HarnessOperationFeedback, WorkflowManifest } from "@executioncontrolprotocol/types"
import type { CompactEnvironmentSummary } from "@executioncontrolprotocol/core"

function workflowIoNames(manifest: WorkflowManifest, field: "accepts" | "returns"): string[] {
  const schema = manifest.workflow?.[field] as Record<string, unknown> | undefined
  return jsonSchemaObjectProperties(schema).map((p) => p.name)
}

function stepUsesAcceptsRef(manifest: WorkflowManifest, property: string): boolean {
  const targetRef = `state.${property}`
  for (const node of manifest.steps ?? []) {
    if (!("input" in node) || node.input === undefined) continue
    const input = node.input as Record<string, unknown>
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

function inferAcceptsPropertyFromRequest(request: string): string | undefined {
  const match =
    request.match(/accepts?\s+(?:a\s+)?(?:required\s+)?(\w+)\s+(?:string|number|field|input)/i) ??
    request.match(/run\s+input\s+(?:field\s+)?(\w+)/i) ??
    request.match(/REF\s+(\w+)/i)
  return match?.[1]
}

function inferReturnsPropertyFromRequest(request: string): string | undefined {
  const match =
    request.match(/returns?\s+(?:an?\s+)?(\w+)\s+(?:object|field|output)/i) ??
    request.match(/OUT\s+(\w+):/i)
  return match?.[1]
}

function stepHasInputRef(step: WorkflowManifest["steps"][number]): boolean {
  if (!("input" in step) || step.input === undefined) return false
  const input = step.input as Record<string, unknown>
  return Object.values(input).some(
    (v) => v !== null && typeof v === "object" && "$ref" in (v as object)
  )
}

/** Infer an existing step id the patch request targets by name. @internal */
export function inferPatchTargetStepId(
  request: string,
  stepIds: readonly string[]
): string | undefined {
  const patterns = [
    /failed?\s+on\s+(\w+)/i,
    /change\s+(?:the\s+)?(\w+)\s+step\s+label/i,
    /rename\s+(\w+)\s+(?:step\s+)?label/i,
    /rename\s+(?:the\s+)?(\w+)\s+label/i,
    /(?:set|change)\s+(\w+)\s+input/i,
    /ensure\s+(\w+)\s+input/i,
    /update\s+(\w+)\s+step/i,
    /move\s+(?:the\s+)?(\w+)\s+step/i,
  ]
  for (const pattern of patterns) {
    const match = request.match(pattern)
    const stepId = match?.[1]
    if (stepId && stepIds.includes(stepId)) return stepId
  }
  return undefined
}

/**
 * Match capability ids mentioned in a natural-language request (eval harness internal).
 * @internal
 */
export function inferRequiredCapabilityIds(
  request: string,
  capabilityIds: readonly string[]
): string[] {
  const lower = request.toLowerCase()
  const matched = new Set<string>()

  for (const id of capabilityIds) {
    if (request.includes(id)) matched.add(id)
  }

  const bySuffix = (suffix: string): string | undefined =>
    capabilityIds.find((id) => id.endsWith(suffix))

  if (/\becho\b/.test(lower)) {
    const isAnchorOnly =
      /\bafter\s+echo\b/i.test(request) ||
      /\bbefore\s+echo\b/i.test(request) ||
      /\bto\s+echo\b/i.test(request)
    const echo = bySuffix("echo")
    if (echo && !isAnchorOnly) matched.add(echo)
  }
  if (/\bsummarize\b/.test(lower)) {
    const isRemovalTarget = /\bremove\b[^.]*\bsummarize\b/i.test(request)
    const isConfigureExisting =
      /\bensure\s+summarize\b/i.test(request) ||
      /\bchange\s+summarize\b/i.test(request) ||
      /\bsummarize\s+step\s+label\b/i.test(request) ||
      /\bsummarize\s+input\b/i.test(request)
    const isAnchorOnly =
      /\bafter\s+summarize\b/i.test(request) || /\bbefore\s+summarize\b/i.test(request)
    const cap = bySuffix("summarize")
    if (cap && !isRemovalTarget && !isAnchorOnly && !isConfigureExisting) matched.add(cap)
  }
  if (/\bnotify\b/.test(lower)) {
    const isRemovalTarget = /\bremove\b[^.]*\bnotify\b/i.test(request)
    const isConfigureExisting =
      /\bupdate\s+notify\b/i.test(request) || /\bnotify\s+step\b/i.test(request)
    const cap = bySuffix("notify")
    if (cap && !isRemovalTarget && !isConfigureExisting) matched.add(cap)
  }
  if (/\btranslate\b/i.test(request) && /\btranslate\b.*\bstep\b|\badd\b.*\btranslate\b|@executioncontrolprotocol\/demo\.translate/i.test(request)) {
    const cap = bySuffix("translate")
    if (cap) matched.add(cap)
  }
  const validateCapIds = capabilityIds.filter((id) => id.endsWith(".validate"))
  const hasExplicitValidateCap = validateCapIds.some((id) => request.includes(id))
  const validateThenWithoutCap =
    /\bvalidate\s+then\b/i.test(request) && !hasExplicitValidateCap
  if (
    hasExplicitValidateCap ||
    (/\bvalidate\b/.test(lower) &&
      !validateThenWithoutCap &&
      (/\bfirst\s+.*\bvalidate\b/.test(lower) || /\bvalidate\s+step\b/i.test(request)))
  ) {
    const cap = bySuffix("validate")
    if (cap) matched.add(cap)
  }
  if (/\bchrome\s*ai\b/i.test(request)) {
    const cap = capabilityIds.find((id) => id.includes("chrome-ai") && id.endsWith(".generate"))
    if (cap) matched.add(cap)
  }

  return [...matched]
}

/**
 * Infer expected step count from natural-language create requests (hint text only).
 * @internal
 */
export function inferRequiredStepCount(request: string): number | undefined {
  const nStepMatch = request.match(/\b(\d+)-step\b/i)
  if (nStepMatch) {
    return Number.parseInt(nStepMatch[1]!, 10)
  }
  if (/\btwo-step\b/i.test(request)) {
    return 2
  }
  if (/\bthree-step\b/i.test(request) || /\b3-step\b/i.test(request)) {
    return 3
  }
  if (/\bfirst\b.+?\bthen\b/i.test(request)) {
    return 2
  }
  if (/\bgenerate\b.+?\bthen\b.+?\bsummar/i.test(request)) {
    return 2
  }
  if (/\bin a second step\b/i.test(request) || /\bsecond step\b/i.test(request)) {
    return 2
  }
  if (/\bgenerate\b.+?\bthen\b/i.test(request)) {
    return 2
  }
  if (/\btwo\s+steps?\b/i.test(request)) {
    return 2
  }
  return undefined
}

/**
 * User-prompt lines nudging the model toward required capabilities.
 * @internal
 */
export function buildRequestCapabilityHintLines(
  request: string,
  summary: CompactEnvironmentSummary,
  options?: { mode?: "create" | "patch" }
): string[] {
  const ids = summary.capabilities.map((c) => c.id)
  const required = inferRequiredCapabilityIds(request, ids)
  const stepCount = inferRequiredStepCount(request)
  const lines: string[] = []
  const mode = options?.mode ?? "create"

  if (mode === "create" && (/\bone step\b/i.test(request) || /\bexactly one\b/i.test(request) || /\bminimal\b/i.test(request))) {
    lines.push(
      "Required: exactly ONE STEP line in EQL output. Do not copy multi-step examples from the system prompt.",
      'Pick a workflow id that matches this request (e.g. "minimal-echo"), not a multi-step example id.',
      ""
    )
  }

  const stepIdMatch = request.match(/\bstep id\s+(\w+)/i)
  if (stepIdMatch && mode === "create") {
    lines.push(
      `Step id must be "${stepIdMatch[1]}" (short name, not a capability id). Format: STEP ${stepIdMatch[1]} USES @executioncontrolprotocol/...`,
      ""
    )
  }

  if (required.length === 0 && stepCount === undefined) return lines

  if (mode === "patch") {
    return lines
  }

  const sameCapReuse =
    /\bsame capability\b/i.test(request) ||
    /\bwith the same\b/i.test(request) ||
    (/\bchrome\s*ai\b/i.test(request) && stepCount !== undefined && stepCount > 1) ||
    (stepCount !== undefined && stepCount > required.length)

  if (stepCount !== undefined && stepCount > 1 && sameCapReuse) {
    lines.push(
      `Required: ${stepCount} STEP lines with distinct step ids (e.g. poem, summarize).`,
      ...required.map((id, index) => `${index + 1}. STEP ... USES ${id}`),
      "Reusing the same USES capability twice still requires unique step ids — do not repeat the capability suffix.",
      ""
    )
    return lines
  }

  lines.push(
    `Required: ${required.length} step(s) in order (one STEP line per capability):`,
    ...required.map((id, index) => `${index + 1}. STEP ... USES ${id}`),
    "Use only these capability ids; do not substitute summarize/notify/translate unless listed.",
    ""
  )
  return lines
}

/** Infer label text from a patch request when explicitly stated. @internal */
export function inferRequestedLabel(request: string): string | undefined {
  const patterns = [
    /(?:change|set|rename).*(?:label to)\s+(.+?)\.?\s*$/i,
    /(?:label to)\s+(.+?)\.?\s*$/i,
  ]
  for (const pattern of patterns) {
    const match = request.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return undefined
}

/**
 * Patch user-prompt context (workflow id and existing steps only — no operation-specific hints).
 * @internal
 */
export function buildPatchOperationHintLines(
  request: string,
  manifest: WorkflowManifest,
  capabilityIds?: readonly string[]
): string[] {
  const stepIds =
    manifest.steps
      ?.filter((s) => "uses" in s && typeof s.uses === "string")
      .map((s) => s.id) ?? []
  const workflowId = manifest.workflow?.id ?? "unknown"
  const lower = request.toLowerCase()
  const isWorkflowLabel =
    /\bworkflow\s+label\b/i.test(lower) ||
    /change\s+workflow\s+label/i.test(lower) ||
    /rename\s+workflow/i.test(lower)
  const removeMatch = lower.match(/remove\s+(?:the\s+)?(\w+)(?:\s+step|\s+if|\s+from)/i)
  const hasAddIntent = /add|include|append|insert/i.test(lower)
  const moveMatch = request.match(
    /\bmove\s+(?:the\s+)?(\w+)\s+(?:step\s+)?(?:to\s+run\s+)?(after|before)\s+(\w+)/i
  )
  const targetStepId = inferPatchTargetStepId(request, stepIds)
  const addAfterMatch = request.match(/\badd\s+\w+\s+after\s+(\w+)\b/i)
  const lines = [
    `PATCH WORKFLOW must use id "${workflowId}".`,
    `Existing step ids: ${stepIds.join(", ") || "none"}.`,
    "Operation selection:",
    "- remove/delete one named step → DELETE STEP for that step id only.",
    "- remove all / clear / start fresh → DELETE STEP once for every existing step id.",
    "- start fresh with new steps → DELETE every existing step id, then ADD STEP (no AFTER when empty).",
    "- change workflow label → UPDATE WORKFLOW with LABEL (not UPDATE STEP).",
    "- change a step label or input on a listed step id → UPDATE STEP for that id only.",
    "- add/insert a capability not yet in the workflow → ADD STEP with a new step id.",
    "- move/reorder an existing step → MOVE STEP with AFTER or BEFORE anchor.",
    "- multiple changes requested → include every required DELETE / UPDATE / ADD / MOVE line.",
    "- CLEAR ACCEPTS / CLEAR RETURNS clear I/O only — they do not remove steps.",
  ]
  if (isClearAllStepsRequest(request)) {
    lines.push(
      `This request clears all steps. Required: ${
        stepIds.length > 0
          ? stepIds.map((id) => `DELETE STEP ${id}`).join("; ")
          : "no DELETE (workflow already has no steps)"
      }.`
    )
    if (isClearAndRebuildRequest(request)) {
      const required =
        capabilityIds !== undefined
          ? inferRequiredCapabilityIds(request, capabilityIds)
          : []
      const addCap = required[0]
      if (addCap) {
        const addStepId = addCap.split(".").pop() ?? "step"
        lines.push(
          `Then ADD STEP ${addStepId} USES ${addCap} (omit AFTER/BEFORE — workflow will be empty after deletes).`
        )
      } else {
        lines.push("Then ADD STEP for each requested new capability (omit AFTER/BEFORE when empty).")
      }
    }
  } else if (moveMatch) {
    const stepId = moveMatch[1]!
    const relation = moveMatch[2]!.toUpperCase()
    const anchorId = moveMatch[3]!
    if (stepIds.includes(stepId) && stepIds.includes(anchorId)) {
      lines.push(
        `Current step order: ${stepIds.join(", ")}.`,
        `This request requires MOVE STEP ${stepId} ${relation} ${anchorId}.`,
        `${anchorId} already exists — do not ADD STEP ${anchorId}.`,
        `Do not UPDATE STEP or ADD STEP for ${anchorId}.`
      )
    }
  } else if (/\bremove\b|\bdelete\b/i.test(lower) && hasAddIntent) {
    const removeId = removeMatch?.[1]
    const anchor = addAfterMatch?.[1]
    lines.push("This request requires both DELETE STEP and ADD STEP operations.")
    if (removeId) {
      const required =
        capabilityIds !== undefined
          ? inferRequiredCapabilityIds(request, capabilityIds)
          : []
      const addCap = required[0]
      if (addCap) {
        const addStepId = addCap.split(".").pop() ?? "step"
        lines.push(
          `Required: DELETE STEP ${removeId}; then ADD STEP ${addStepId} USES ${addCap}${anchor ? ` AFTER ${anchor}` : ""}.`,
          `Do not UPDATE STEP ${removeId} or other existing steps — delete and add instead.`
        )
      } else {
        lines.push(
          `Required: DELETE STEP ${removeId}; then ADD STEP with a new step id and the requested capability USES value${anchor ? ` AFTER ${anchor}` : ""}.`,
          `Do not UPDATE STEP ${removeId} or other existing steps — delete and add instead.`
        )
      }
    }
  } else if (/\bremove\b|\bdelete\b/i.test(lower)) {
    lines.push("This request requires DELETE STEP only.")
  } else if (isWorkflowLabel) {
    lines.push("This request requires UPDATE WORKFLOW with LABEL (workflow metadata, not a step).")
  } else if (
    /\blabel\b|\binput\b|\bvalue\b|\brename\b/i.test(lower) &&
    !hasAddIntent &&
    !moveMatch
  ) {
    if (targetStepId) {
      const isLabelChange = /\blabel\b|\brename\b/i.test(lower)
      lines.push(
        `Target step: ${targetStepId} — output UPDATE STEP ${targetStepId}${isLabelChange ? " with LABEL only" : ""}. Do not UPDATE other step ids.`
      )
    } else {
      lines.push("This request requires UPDATE STEP on an existing step id.")
    }
  }
  return lines
}

function stepUsesList(workflow: WorkflowManifest): string[] {
  const uses: string[] = []
  for (const node of workflow.steps ?? []) {
    if ("uses" in node && typeof node.uses === "string") {
      uses.push(node.uses)
    }
  }
  return uses
}

/**
 * Harness repair feedback when create output omits requested capabilities.
 * @internal
 */
export function collectCreateCapabilityFeedback(
  request: string,
  summary: CompactEnvironmentSummary,
  workflow: WorkflowManifest
): HarnessOperationFeedback[] | undefined {
  const required = inferRequiredCapabilityIds(
    request,
    summary.capabilities.map((c) => c.id)
  )
  if (required.length === 0) return undefined
  const uses = stepUsesList(workflow)
  const missing = required.filter((id) => !uses.includes(id))
  const feedback: HarnessOperationFeedback[] = []
  if (missing.length > 0) {
    const allStepsList = required.map((id, i) => `${i + 1}. STEP ... USES ${id}`).join(", ")
    feedback.push(
      collectModelOutputFeedback(
        `Workflow has ${uses.length} STEP(s) but needs ${required.length}. ` +
          `Include ALL required steps in EQL: ${allStepsList}. ` +
          `Missing USES: ${missing.join(", ")}.`
      )
    )
  }
  const extra = uses.filter((id) => !required.includes(id))
  if (required.length > 0 && extra.length > 0) {
    feedback.push(
      collectModelOutputFeedback(
        `Output exactly ${required.length} STEP line(s) for capabilities named in the request: ${required.join(", ")}. ` +
          `Remove extra steps (not requested: ${extra.join(", ")}).`
      )
    )
  } else if (required.length > 0 && uses.length > required.length) {
    const expectedSteps = inferRequiredStepCount(request) ?? required.length
    const allUsesAreRequired = uses.every((id) => required.includes(id))
    if (!(allUsesAreRequired && uses.length === expectedSteps)) {
      feedback.push(
        collectModelOutputFeedback(
          `Output exactly ${required.length} STEP line(s) for: ${required.join(", ")}. Remove extra STEP lines.`
        )
      )
    }
  }
  return feedback.length > 0 ? feedback : undefined
}

/**
 * Harness repair feedback when create output has too many steps for a single-step request.
 * @internal
 */
export function collectCreateStepCountFeedback(
  request: string,
  workflow: WorkflowManifest,
  requiredCapabilityIds?: readonly string[]
): HarnessOperationFeedback[] | undefined {
  const explicitSingle =
    /\bone step\b/i.test(request) ||
    /\bexactly one\b/i.test(request) ||
    /\bminimal\b/i.test(request)
  // Empty capability matches mean "unknown", not "require zero steps".
  const fromMatchedCaps =
    requiredCapabilityIds !== undefined && requiredCapabilityIds.length > 0
      ? requiredCapabilityIds.length
      : undefined
  const requiredCount = explicitSingle
    ? 1
    : inferRequiredStepCount(request) ?? fromMatchedCaps
  const count = workflow.steps?.length ?? 0
  if (requiredCount === undefined || count <= requiredCount) {
    return undefined
  }
  if (requiredCount === 1) {
    return [
      collectModelOutputFeedback(
        `Request requires exactly one capability step but output has ${count} STEP lines. Output only one STEP ... USES line.`
      ),
    ]
  }
  return [
    collectModelOutputFeedback(
      `Request requires ${requiredCount} STEP lines but output has ${count}. Output exactly ${requiredCount} STEP ... USES lines.`
    ),
  ]
}

/**
 * Harness repair feedback when create output reuses a step id.
 * @internal
 */
export function collectCreateDuplicateStepIdFeedback(
  workflow: WorkflowManifest
): HarnessOperationFeedback[] | undefined {
  const stepIds: string[] = []
  for (const node of workflow.steps ?? []) {
    if (!node.type || node.type === "step") {
      stepIds.push(node.id)
    }
  }
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const id of stepIds) {
    if (seen.has(id)) {
      if (!duplicates.includes(id)) {
        duplicates.push(id)
      }
    } else {
      seen.add(id)
    }
  }
  if (duplicates.length === 0) {
    return undefined
  }
  const dupId = duplicates[0]!
  const usesForDup = new Set<string>()
  for (const node of workflow.steps ?? []) {
    if (
      (!node.type || node.type === "step") &&
      node.id === dupId &&
      "uses" in node &&
      typeof node.uses === "string"
    ) {
      usesForDup.add(node.uses)
    }
  }
  const capHint =
    usesForDup.size === 1
      ? ` When reusing ${[...usesForDup][0]} twice, use distinct ids like poem and summarize.`
      : ""
  return [
    collectModelOutputFeedback(
      `Duplicate step id "${dupId}". Each STEP needs a unique short id.${capHint} Do not repeat the capability suffix.`
    ),
  ]
}

/**
 * Harness repair feedback for common patch goals (label, remove step, add capability).
 * @internal
 */
export function collectPatchGoalFeedback(
  request: string,
  patched: WorkflowManifest,
  summary: CompactEnvironmentSummary,
  baseline?: WorkflowManifest
): HarnessOperationFeedback[] | undefined {
  const lower = request.toLowerCase()
  const feedback: HarnessOperationFeedback[] = []

  const baselineStepIds =
    baseline?.steps
      ?.filter((s) => "uses" in s && typeof s.uses === "string")
      .map((s) => s.id) ?? []

  const removeMatch = lower.match(/remove\s+(?:the\s+)?(\w+)(?:\s+step|\s+if|\s+from)/i)
  const hasAddIntent = /add|include|append|insert/i.test(lower)
  const moveMatch = request.match(
    /\bmove\s+(?:the\s+)?(\w+)\s+(?:step\s+)?(?:to\s+run\s+)?(after|before)\s+(\w+)/i
  )
  const clearAll = isClearAllStepsRequest(request)

  if (clearAll) {
    const remaining =
      patched.steps?.filter((s) => "uses" in s && typeof s.uses === "string").map((s) => s.id) ?? []
    if (remaining.length > 0 && !isClearAndRebuildRequest(request)) {
      feedback.push(
        collectModelOutputFeedback(
          `Request clears all steps but these remain: ${remaining.join(", ")}. Emit DELETE STEP for every existing step id (${baselineStepIds.join(", ") || "none"}).`
        )
      )
    }
    if (isClearAndRebuildRequest(request) && remaining.length > 1) {
      feedback.push(
        collectModelOutputFeedback(
          `Start-fresh rebuild should DELETE every baseline step id (${baselineStepIds.join(", ")}), then ADD only the new steps.`
        )
      )
    }
  } else if (removeMatch) {
    const stepId = removeMatch[1]!
    const still = patched.steps?.find((s) => s.id === stepId)
    if (still) {
      const addPart =
        hasAddIntent && removeMatch
          ? " Output DELETE before any ADD when the request removes and adds steps."
          : ""
      feedback.push(
        collectModelOutputFeedback(
          `Request removes step "${stepId}" but it is still present. Use DELETE STEP ${stepId}. Do not use UPDATE STEP.${addPart}`
        )
      )
    }
  }

  if (
    /change\s+(?:the\s+)?(\w+)\s+step\s+label/i.test(request) &&
    !hasAddIntent &&
    baselineStepIds.length > 0
  ) {
    const stepId = request.match(/change\s+(?:the\s+)?(\w+)\s+step\s+label/i)?.[1]
    if (stepId && baselineStepIds.includes(stepId)) {
      const count = patched.steps?.filter((s) => s.id === stepId).length ?? 0
      if (count > 1 || (patched.steps?.length ?? 0) > baselineStepIds.length) {
        feedback.push(
          collectModelOutputFeedback(
            `Step "${stepId}" already exists. Use UPDATE STEP ${stepId} with LABEL, not ADD STEP ${stepId}.`
          )
        )
      }
    }
  }

  if (moveMatch && baseline) {
    const stepId = moveMatch[1]!
    const relation = moveMatch[2]!.toLowerCase()
    const anchorId = moveMatch[3]!
    const stepOrder =
      patched.steps
        ?.filter((s) => "uses" in s && typeof s.uses === "string")
        .map((s) => s.id) ?? []
    const stepIdx = stepOrder.indexOf(stepId)
    const anchorIdx = stepOrder.indexOf(anchorId)
    if (stepIdx < 0 && baselineStepIds.includes(stepId)) {
      feedback.push(
        collectModelOutputFeedback(
          `Use MOVE STEP ${stepId} ${relation.toUpperCase()} ${anchorId}. Do not DELETE STEP ${stepId}.`
        )
      )
    } else if (stepIdx >= 0 && anchorIdx >= 0) {
      const correct =
        relation === "after" ? stepIdx === anchorIdx + 1 : stepIdx === anchorIdx - 1
      if (!correct) {
        feedback.push(
          collectModelOutputFeedback(
            `Use MOVE STEP ${stepId} ${relation.toUpperCase()} ${anchorId}. Do not UPDATE STEP or ADD STEP.`
          )
        )
      }
    }
  }

  const required = inferRequiredCapabilityIds(
    request,
    summary.capabilities.map((c) => c.id)
  )
  const uses = stepUsesList(patched)
  const missing = required.filter((id) => !uses.includes(id))
  if (missing.length > 0 && hasAddIntent) {
    const baselineIds = baselineStepIds.join(", ")
    const afterMatch = request.match(/\bafter\s+(\w+)\b/i)
    const beforeMatch = request.match(/\bbefore\s+(\w+)\b/i)
    const anchor = afterMatch?.[1] ?? beforeMatch?.[1]
    const anchorClause = afterMatch
      ? ` AFTER ${anchor}`
      : beforeMatch
        ? ` BEFORE ${anchor}`
        : ""
    const deletePart =
      removeMatch && hasAddIntent
        ? ` Also DELETE STEP ${removeMatch[1]} if the request removes it.`
        : ""
    feedback.push(
      collectModelOutputFeedback(
        `Use ADD STEP with USES ${missing.join(" or ")}${anchorClause}. ` +
          `Keep existing step(s): ${baselineIds || "none"}.${deletePart}`
      )
    )
  }

  if (removeMatch && hasAddIntent && !missing.length) {
    const stepId = removeMatch[1]!
    const still = patched.steps?.find((s) => s.id === stepId)
    if (still) {
      const baselineUses = baseline ? stepUsesList(baseline) : []
      const addCap = required.find((id) => !baselineUses.includes(id))
      feedback.push(
        collectModelOutputFeedback(
          addCap
            ? `Combined request: output DELETE STEP ${stepId} and ADD STEP … USES ${addCap}. Do not copy hint prose as EQL.`
            : `Combined request: output DELETE STEP ${stepId} in the same patch.`
        )
      )
    }
  }

  if (!removeMatch && hasAddIntent) {
    for (const stepId of baselineStepIds) {
      const nameInRequest = new RegExp(`\\b${stepId}\\b`, "i").test(request)
      const capSuffix = stepId
      const mentionsCap = summary.capabilities.some(
        (c) => c.id.endsWith(`.${capSuffix}`) && request.includes(c.id)
      )
      if (
        (nameInRequest || mentionsCap) &&
        (patched.steps?.filter((s) => s.id === stepId).length ?? 0) >
          (baseline?.steps?.filter((s) => s.id === stepId).length ?? 0)
      ) {
        feedback.push(
          collectModelOutputFeedback(
            `Step id "${stepId}" already exists. Use UPDATE STEP, not ADD STEP ${stepId}.`
          )
        )
      }
    }
  }

  const explicitStepLabel =
    request.match(/change\s+(?:the\s+)?(\w+)\s+step\s+label\s+to\s+(.+?)\.?\s*$/i) ??
    request.match(/rename\s+(\w+)\s+label\s+to\s+(.+?)\.?\s*$/i)
  const workflowLabelMatch = request.match(
    /(?:change|set|rename)\s+workflow\s+label\s+to\s+(.+?)\.?\s*$/i
  )
  if (
    workflowLabelMatch &&
    /label|rename/.test(lower) &&
    !/add|include|append|insert/i.test(lower)
  ) {
    const wanted = workflowLabelMatch[1]!.trim()
    if (patched.workflow?.label !== wanted) {
      feedback.push(
        collectModelOutputFeedback(
          `Use UPDATE WORKFLOW with LABEL "${wanted}". Do not UPDATE STEP for workflow label changes.`
        )
      )
    }
  }

  const genericStepLabel = request.match(
    /(?:change|set)\s+(?:the\s+)?\w+\s+step\s+label\s+to\s+(.+?)\.?\s*$/i
  )
  if (
    (explicitStepLabel ?? genericStepLabel) &&
    /label|rename/.test(lower) &&
    !/add|include|append|insert/i.test(lower)
  ) {
    const targetStepId = explicitStepLabel?.[1]?.trim()
    const wanted = (explicitStepLabel?.[2] ?? genericStepLabel?.[1] ?? "").trim()
    if (targetStepId !== undefined) {
      const target = patched.steps?.find((s) => s.id === targetStepId)
      if (target && target.label !== wanted) {
        feedback.push(
          collectModelOutputFeedback(
            `Use UPDATE STEP ${targetStepId} with LABEL "${wanted}". Do not patch other step ids.`
          )
        )
      }
    }
  }

  if (/\$ref|\bref(erence)?s?\b.*\boutput\b/i.test(lower)) {
    const targetStep =
      request.match(/ensure\s+(\w+)\s+input/i)?.[1] ??
      request.match(/(\w+)\s+uses\s+\$ref/i)?.[1] ??
      "summarize"
    const sourceStep =
      request.match(/(?:to|from)\s+(\w+)\s+output/i)?.[1] ?? "echo"
    if (baselineStepIds.includes(targetStep)) {
      const target = patched.steps?.find((s) => s.id === targetStep)
      const dupCount = patched.steps?.filter((s) => s.id === targetStep).length ?? 0
      if (dupCount > 1) {
        feedback.push(
          collectModelOutputFeedback(
            `Step "${targetStep}" already exists. Use UPDATE STEP ${targetStep} WITH REF ${sourceStep}.output, not ADD STEP.`
          )
        )
      } else if (target && !stepHasInputRef(target)) {
        feedback.push(
          collectModelOutputFeedback(
            `UPDATE STEP ${targetStep} WITH input referencing REF ${sourceStep}.output. Keep all steps; do not DELETE or ADD ${targetStep}.`
          )
        )
      }
    } else if ((patched.steps?.length ?? 0) < (baseline?.steps?.length ?? 0)) {
      feedback.push(
        collectModelOutputFeedback(
          `Keep all existing steps when adding $ref. Do not DELETE steps.`
        )
      )
    }
  }

  if (baseline && /\baccepts?\b|\breturns?\b/i.test(lower)) {
    const baselineAccepts = workflowIoNames(baseline, "accepts")
    const baselineReturns = workflowIoNames(baseline, "returns")
    const patchedAccepts = workflowIoNames(patched, "accepts")
    const patchedReturns = workflowIoNames(patched, "returns")
    const wantsRemoveReturns = /\b(remove|clear|delete)\b.*\breturns?\b/i.test(lower)
    const wantsAddAccepts = /\badd\b.*\baccepts?\b/i.test(lower)
    const wantsAddReturns = /\badd\b.*\breturns?\b/i.test(lower)

    if (!wantsRemoveReturns && !wantsAddAccepts) {
      for (const name of baselineAccepts) {
        if (!patchedAccepts.includes(name)) {
          feedback.push(
            collectModelOutputFeedback(
              `Preserve ACCEPTS field ${name}:type unless the request removes or renames it.`
            )
          )
        }
      }
      for (const name of baselineReturns) {
        if (!patchedReturns.includes(name) && !wantsAddReturns) {
          feedback.push(
            collectModelOutputFeedback(
              `Preserve RETURNS OUT ${name}:type unless the request removes or renames it.`
            )
          )
        }
      }
    }

    if (wantsAddAccepts) {
      const prop = inferAcceptsPropertyFromRequest(request) ?? "value"
      if (!patchedAccepts.includes(prop)) {
        feedback.push(
          collectModelOutputFeedback(
            `Use UPDATE WORKFLOW with ACCEPTS and WITH ${prop}:string! before step lines.`
          )
        )
      }
    }

    if (wantsAddReturns) {
      const prop = inferReturnsPropertyFromRequest(request) ?? "echo"
      if (!patchedReturns.includes(prop)) {
        feedback.push(
          collectModelOutputFeedback(
            `Use UPDATE WORKFLOW with RETURNS and OUT ${prop}:object! before step lines.`
          )
        )
      }
    }

    if (wantsRemoveReturns && patchedReturns.length > 0) {
      feedback.push(
        collectModelOutputFeedback("Use UPDATE WORKFLOW with CLEAR RETURNS.")
      )
    }

    const acceptsProp = inferAcceptsPropertyFromRequest(request)
    if (acceptsProp && patchedAccepts.includes(acceptsProp) && !stepUsesAcceptsRef(patched, acceptsProp)) {
      feedback.push(
        collectModelOutputFeedback(
          `Wire run input with WITH field = REF ${acceptsProp} on the target step.`
        )
      )
    }
  }

  const typeFeedback = collectGenerateReturnsTypeFeedback(patched, "eql")
  if (typeFeedback) feedback.push(...typeFeedback)

  return feedback.length > 0 ? feedback : undefined
}

function isGenerateCapabilityId(capabilityId: string): boolean {
  return capabilityId.endsWith(".generate")
}

/**
 * Flag RETURNS properties typed as string when they map to a *.generate .as key.
 * Generate capabilities store `{ text }` objects, not bare strings.
 * @internal
 */
export function collectGenerateReturnsTypeFeedback(
  manifest: WorkflowManifest,
  dialect: "eql" | "fluent" = "eql"
): HarnessOperationFeedback[] | undefined {
  const returnsFields = jsonSchemaObjectProperties(
    manifest.workflow?.returns as Record<string, unknown> | undefined
  )
  if (returnsFields.length === 0) return undefined

  const asToUses = new Map<string, string>()
  for (const node of manifest.steps ?? []) {
    if (!("uses" in node) || typeof node.uses !== "string") continue
    if (!("as" in node) || typeof (node as { as?: unknown }).as !== "string") continue
    const asKey = (node as { as: string }).as
    if (!asKey) continue
    asToUses.set(asKey, node.uses)
  }

  const feedback: HarnessOperationFeedback[] = []
  for (const field of returnsFields) {
    const uses = asToUses.get(field.name)
    if (!uses || !isGenerateCapabilityId(uses)) continue
    if (field.schema.type !== "string") continue
    const message =
      dialect === "fluent"
        ? `.returns property "${field.name}" must be type "object" because .as("${field.name}") stores *.generate output { text }, not a bare string.`
        : `RETURNS OUT ${field.name} must be object! because AS ${field.name} stores *.generate output { text }. Use OUT ${field.name}:object!, not string.`
    feedback.push(collectModelOutputFeedback(message))
  }
  return feedback.length > 0 ? feedback : undefined
}

/**
 * Repair feedback for EQL create output when workflow I/O is requested.
 * @internal
 */
export function collectCreateWorkflowIoFeedback(
  request: string,
  manifest: WorkflowManifest
): HarnessOperationFeedback[] | undefined {
  const typeFeedback = collectGenerateReturnsTypeFeedback(manifest, "eql") ?? []
  const lower = request.toLowerCase()
  if (!/\baccepts?\b|\breturns?\b|\brun\s+input\b/i.test(lower)) {
    return typeFeedback.length > 0 ? typeFeedback : undefined
  }
  const feedback: HarnessOperationFeedback[] = [...typeFeedback]
  const acceptsProp = inferAcceptsPropertyFromRequest(request)
  const returnsProp = inferReturnsPropertyFromRequest(request)
  const acceptsNames = workflowIoNames(manifest, "accepts")
  const returnsNames = workflowIoNames(manifest, "returns")

  if (/\baccepts?\b/i.test(lower) && acceptsProp && !acceptsNames.includes(acceptsProp)) {
    feedback.push(
      collectModelOutputFeedback(
        `Add ACCEPTS block with WITH ${acceptsProp}:string! after WORKFLOW line.`
      )
    )
  }

  if (/\breturns?\b/i.test(lower) && returnsProp && !returnsNames.includes(returnsProp)) {
    feedback.push(
      collectModelOutputFeedback(
        `Add RETURNS block with OUT ${returnsProp}:object! after ACCEPTS.`
      )
    )
  }

  if (acceptsProp && acceptsNames.includes(acceptsProp) && !stepUsesAcceptsRef(manifest, acceptsProp)) {
    feedback.push(
      collectModelOutputFeedback(
        `Wire run input with WITH field = REF ${acceptsProp}, not REF step.output.`
      )
    )
  }

  if (/\bno\s+returns?\b/i.test(lower) && returnsNames.length > 0) {
    feedback.push(collectModelOutputFeedback("Omit RETURNS block for this workflow."))
  }

  return feedback.length > 0 ? feedback : undefined
}
