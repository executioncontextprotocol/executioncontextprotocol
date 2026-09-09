import {
  collectModelOutputFeedback,
  jsonSchemaObjectProperties,
  isClearAllStepsRequest,
  isClearAndRebuildRequest,
  type CompactEnvironmentSummary,
} from "@executioncontrolprotocol/core"
import {
  inferPatchTargetStepId,
  inferRequiredCapabilityIds,
  collectGenerateReturnsTypeFeedback,
} from "@executioncontrolprotocol/harnesses-browser-nano"
import type { HarnessOperationFeedback, StepNode, WorkflowManifest } from "@executioncontrolprotocol/types"

const FLUENT_ANTI_PATTERNS =
  "Do not use EQL, PATCH WORKFLOW, UPDATE STEP, DELETE STEP, MOVE STEP, ADD STEP, .remove(), .after(), or moveStep."

function stepUsesList(workflow: WorkflowManifest): string[] {
  const uses: string[] = []
  for (const node of workflow.steps ?? []) {
    if ("uses" in node && typeof node.uses === "string") {
      uses.push(node.uses)
    }
  }
  return uses
}

function flatStepIds(workflow: WorkflowManifest): string[] {
  return (
    workflow.steps
      ?.filter((s) => "uses" in s && typeof s.uses === "string")
      .map((s) => s.id) ?? []
  )
}

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
    request.match(/ref\(["'](\w+)["']\)/i)
  return match?.[1]
}

function inferReturnsPropertyFromRequest(request: string): string | undefined {
  const match =
    request.match(/returns?\s+(?:an?\s+)?(\w+)\s+(?:object|field|output)/i) ??
    request.match(/output\s+(?:field\s+)?(\w+)/i)
  return match?.[1]
}

function stepHasInputRef(step: WorkflowManifest["steps"][number]): boolean {
  if (!("input" in step) || step.input === undefined) return false
  const input = step.input as Record<string, unknown>
  return Object.values(input).some(
    (v) => v !== null && typeof v === "object" && "$ref" in (v as object)
  )
}

/**
 * Fluent-only patch hints for the Browser Coding harness (no EQL vocabulary).
 * @category Harness
 */
export function buildFluentPatchHintLines(
  request: string,
  manifest: WorkflowManifest,
  capabilityIds?: readonly string[]
): string[] {
  const stepIds = flatStepIds(manifest)
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
    FLUENT_ANTI_PATTERNS,
    `Keep workflow .id("${workflowId}") on export default workflow(...).`,
    isClearAllStepsRequest(request)
      ? `Clear-all request: rebuild .run([...]) without baseline step ids (${stepIds.join(", ") || "none"}).`
      : `Preserve every existing step .id(...) for ids: ${stepIds.join(", ") || "none"}.`,
    "Return a complete revised module: import { workflow, step, ref } from \"@executioncontrolprotocol/core\" when using ref().",
    "Edit rules:",
    "- label or input on an existing step → change that step only; keep .id(\"<stepId>\") unchanged.",
    "- remove/delete a step → rebuild .run([...]) without that step.",
    "- remove all / clear / start fresh → .run([]) or rebuild with only new steps; keep .id() and I/O unless asked to clear them.",
    "- add a capability → append step(...) to .run([...]); use ref(\"priorStep.output\") when chaining.",
    "- move/reorder → reorder entries inside .run([...]); do not invent move helpers.",
    "- workflow label → change workflow(\"New label\") and keep .id(\"...\").",
  ]

  if (isClearAllStepsRequest(request)) {
    lines.push(
      stepIds.length > 0
        ? `Omit every baseline step id from .run([...]): ${stepIds.join(", ")}.`
        : "Workflow already has no steps — keep .run([])."
    )
    if (isClearAndRebuildRequest(request)) {
      const required =
        capabilityIds !== undefined
          ? inferRequiredCapabilityIds(request, capabilityIds)
          : []
      if (required[0]) {
        lines.push(
          `Then include only the new step("${required[0]}", ...).id(...) entries in .run([...]).`
        )
      } else {
        lines.push("Then include only the newly requested steps in .run([...]).")
      }
    } else {
      lines.push("Use .run([]) when the request leaves no steps.")
    }
  } else if (moveMatch) {
    const stepId = moveMatch[1]!
    const relation = moveMatch[2]!.toLowerCase()
    const anchorId = moveMatch[3]!
    if (stepIds.includes(stepId) && stepIds.includes(anchorId)) {
      const order =
        relation === "after"
          ? stepIds.filter((id) => id !== stepId).flatMap((id) =>
              id === anchorId ? [anchorId, stepId] : [id]
            )
          : stepIds.filter((id) => id !== stepId).flatMap((id) =>
              id === anchorId ? [stepId, anchorId] : [id]
            )
      lines.push(
        `Current step order: ${stepIds.join(", ")}.`,
        `Reorder .run([...]) so "${stepId}" is ${relation} "${anchorId}" (target order: ${order.join(", ")}).`
      )
    }
  } else if (/\bremove\b|\bdelete\b/i.test(lower) && hasAddIntent) {
    const removeId = removeMatch?.[1]
    const anchor = addAfterMatch?.[1]
    lines.push("Remove the listed step from .run([...]), then append the new step.")
    if (removeId) {
      const required =
        capabilityIds !== undefined
          ? inferRequiredCapabilityIds(request, capabilityIds)
          : []
      const addCap = required[0]
      if (addCap) {
        const addStepId = addCap.split(".").pop() ?? "step"
        lines.push(
          `Omit step .id("${removeId}") from .run([...]); add step("${addCap}", ...).id("${addStepId}")${anchor ? ` after "${anchor}" in the array` : ""}.`
        )
      }
    }
  } else if (/\bremove\b|\bdelete\b/i.test(lower)) {
    lines.push("Rebuild .run([...]) without the removed step id.")
  } else if (isWorkflowLabel) {
    lines.push(
      "Change only the workflow title string in workflow(\"...\"); keep workflow .id() and all step .id() values."
    )
  } else if (
    /\blabel\b|\binput\b|\bvalue\b|\brename\b/i.test(lower) &&
    !hasAddIntent &&
    !moveMatch
  ) {
    if (targetStepId) {
      const isLabelChange = /\blabel\b|\brename\b/i.test(lower)
      lines.push(
        `Target step id "${targetStepId}": update step(..., ${isLabelChange ? "new label" : "label"}).id("${targetStepId}") — do not change other step ids.`
      )
    }
  } else if (hasAddIntent) {
    const required =
      capabilityIds !== undefined
        ? inferRequiredCapabilityIds(request, capabilityIds)
        : []
    if (required.length > 0) {
      lines.push(
        `Append step("${required[0]}", ...) to .run([...])${addAfterMatch ? ` after the step with id "${addAfterMatch[1]}"` : ""}; import ref from "@executioncontrolprotocol/core" when chaining outputs.`
      )
    }
  }

  if (/\baccepts?\b|\breturns?\b|\brun\s+input\b/i.test(lower) && !hasAddIntent) {
    lines.push(
      "Preserve existing .accepts({...}) and .returns({...}) unless the request changes workflow I/O.",
      "Wire accepts keys with ref(\"key\") inside step .with({ ... })."
    )
  }

  if (/\$ref|\bref(erence)?s?\b.*\boutput\b/i.test(lower)) {
    const targetStep =
      request.match(/ensure\s+(\w+)\s+input/i)?.[1] ??
      request.match(/(\w+)\s+uses\s+\$ref/i)?.[1] ??
      "summarize"
    const sourceStep =
      request.match(/(?:to|from)\s+(\w+)\s+output/i)?.[1] ?? "echo"
    if (stepIds.includes(targetStep)) {
      lines.push(
        `Step .id("${targetStep}") must use ref("${sourceStep}.output") inside .with({ ... }).`
      )
    }
  }

  return lines
}

/**
 * Repair feedback for Fluent patch output (manifest checks, not EQL).
 * @category Harness
 */
export function collectFluentPatchGoalFeedback(
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

  for (const stepId of baselineStepIds) {
    const isRemoveTarget =
      removeMatch?.[1] === stepId && /\bremove\b|\bdelete\b/i.test(lower)
    if (clearAll || isRemoveTarget) continue
    const still = patched.steps?.find((s) => s.id === stepId)
    if (!still) {
      feedback.push(
        collectModelOutputFeedback(
          `Baseline step id "${stepId}" is missing. Keep .id("${stepId}") on that step in .run([...]).`
        )
      )
    }
  }

  if (clearAll) {
    const remaining = flatStepIds(patched)
    if (remaining.length > 0 && !isClearAndRebuildRequest(request)) {
      feedback.push(
        collectModelOutputFeedback(
          `Request clears all steps but .run([...]) still has: ${remaining.join(", ")}. Use .run([]).`
        )
      )
    }
    if (isClearAndRebuildRequest(request) && remaining.length > 1) {
      feedback.push(
        collectModelOutputFeedback(
          `Start-fresh rebuild should omit every baseline step id (${baselineStepIds.join(", ")}) and keep only the new steps.`
        )
      )
    }
  } else if (removeMatch) {
    const stepId = removeMatch[1]!
    const still = patched.steps?.find((s) => s.id === stepId)
    if (still) {
      feedback.push(
        collectModelOutputFeedback(
          `Request removes step "${stepId}" but it is still in .run([...]). Rebuild the array without that step.`
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
            `Step "${stepId}" already exists. Update its label via step(...).id("${stepId}"), do not add a duplicate step.`
          )
        )
      }
    }
  }

  if (moveMatch && baseline) {
    const stepId = moveMatch[1]!
    const relation = moveMatch[2]!.toLowerCase()
    const anchorId = moveMatch[3]!
    const stepOrder = flatStepIds(patched)
    const stepIdx = stepOrder.indexOf(stepId)
    const anchorIdx = stepOrder.indexOf(anchorId)
    if (stepIdx >= 0 && anchorIdx >= 0) {
      const correct =
        relation === "after" ? stepIdx === anchorIdx + 1 : stepIdx === anchorIdx - 1
      if (!correct) {
        feedback.push(
          collectModelOutputFeedback(
            `Reorder .run([...]) so step id "${stepId}" is ${relation} "${anchorId}". Do not use moveStep or .after().`
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
    const anchor = afterMatch?.[1]
    feedback.push(
      collectModelOutputFeedback(
        `Append step("${missing.join('" or "')}", ...) to .run([...])` +
          `${anchor ? ` after the step with id "${anchor}"` : ""}. ` +
          `Keep existing step ids: ${baselineIds || "none"}.`
      )
    )
  }

  if (removeMatch && hasAddIntent && !missing.length) {
    const stepId = removeMatch[1]!
    const still = patched.steps?.find((s) => s.id === stepId)
    if (still) {
      feedback.push(
        collectModelOutputFeedback(
          `Combined request: remove step "${stepId}" from .run([...]) and append the new capability step.`
        )
      )
    }
  }

  if (!removeMatch && hasAddIntent) {
    for (const stepId of baselineStepIds) {
      const dupCount = patched.steps?.filter((s) => s.id === stepId).length ?? 0
      const baselineCount =
        baseline?.steps?.filter((s) => s.id === stepId).length ?? 0
      if (dupCount > baselineCount) {
        feedback.push(
          collectModelOutputFeedback(
            `Duplicate step id "${stepId}". Update the existing step with .id("${stepId}"), do not add another.`
          )
        )
      }
    }
  }

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
          `Set workflow("${wanted}") (first argument) while keeping workflow .id("${patched.workflow?.id ?? baseline?.workflow?.id}").`
        )
      )
    }
  }

  const explicitStepLabel =
    request.match(/change\s+(?:the\s+)?(\w+)\s+step\s+label\s+to\s+(.+?)\.?\s*$/i) ??
    request.match(/rename\s+(\w+)\s+label\s+to\s+(.+?)\.?\s*$/i)
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
      const target = patched.steps?.find((s) => s.id === targetStepId) as StepNode | undefined
      if (!target) {
        feedback.push(
          collectModelOutputFeedback(
            `Step id "${targetStepId}" must remain in .run([...]) with .id("${targetStepId}") and label "${wanted}".`
          )
        )
      } else if (target.label !== wanted) {
        feedback.push(
          collectModelOutputFeedback(
            `Step .id("${targetStepId}") must have label "${wanted}" (second argument to step()).`
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
            `Step "${targetStep}" already exists. Use ref("${sourceStep}.output") in .with({...}) on .id("${targetStep}"), do not add a duplicate step.`
          )
        )
      } else if (target && !stepHasInputRef(target)) {
        feedback.push(
          collectModelOutputFeedback(
            `Step .id("${targetStep}") needs .with({ ... ref("${sourceStep}.output") ... }). Keep all baseline step ids.`
          )
        )
      }
    } else if ((patched.steps?.length ?? 0) < (baseline?.steps?.length ?? 0)) {
      feedback.push(
        collectModelOutputFeedback(
          "Keep all existing steps in .run([...]) when adding ref() chains."
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
    const renameAccepts = request.match(/rename\s+accepts?\s+(?:field\s+)?(\w+)\s+to\s+(\w+)/i)

    if (!wantsRemoveReturns && !wantsAddAccepts && !renameAccepts) {
      for (const name of baselineAccepts) {
        if (!patchedAccepts.includes(name)) {
          feedback.push(
            collectModelOutputFeedback(
              `Preserve workflow .accepts() property "${name}" unless the request removes or renames it.`
            )
          )
        }
      }
      for (const name of baselineReturns) {
        if (!patchedReturns.includes(name) && !wantsAddReturns) {
          feedback.push(
            collectModelOutputFeedback(
              `Preserve workflow .returns() property "${name}" unless the request removes or renames it.`
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
            `Add .accepts({ type: "object", properties: { ${prop}: { type: "string" } }, required: ["${prop}"] }) before .run().`
          )
        )
      }
    }

    if (wantsAddReturns) {
      const prop = inferReturnsPropertyFromRequest(request) ?? "echo"
      if (!patchedReturns.includes(prop)) {
        feedback.push(
          collectModelOutputFeedback(
            `Add .returns({ type: "object", properties: { ${prop}: { type: "object" } }, required: ["${prop}"] }) before .run().`
          )
        )
      }
    }

    if (wantsRemoveReturns && patchedReturns.length > 0) {
      feedback.push(
        collectModelOutputFeedback("Remove .returns({...}) from the workflow chain.")
      )
    }

    const acceptsProp = inferAcceptsPropertyFromRequest(request)
    if (acceptsProp && patchedAccepts.includes(acceptsProp) && !stepUsesAcceptsRef(patched, acceptsProp)) {
      feedback.push(
        collectModelOutputFeedback(
          `Wire accepts key "${acceptsProp}" with ref("${acceptsProp}") in a step .with({ ... }).`
        )
      )
    }
  }

  const typeFeedback = collectGenerateReturnsTypeFeedback(patched, "fluent")
  if (typeFeedback) feedback.push(...typeFeedback)

  return feedback.length > 0 ? feedback : undefined
}

/**
 * Repair feedback for Fluent create output when workflow I/O is requested.
 * @category Harness
 */
export function collectCreateWorkflowIoFeedback(
  request: string,
  manifest: WorkflowManifest
): HarnessOperationFeedback[] | undefined {
  const typeFeedback = collectGenerateReturnsTypeFeedback(manifest, "fluent") ?? []
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
        `Add .accepts({ type: "object", properties: { ${acceptsProp}: { type: "string" } }, required: ["${acceptsProp}"] }) before .run().`
      )
    )
  }

  if (/\breturns?\b/i.test(lower) && returnsProp && !returnsNames.includes(returnsProp)) {
    feedback.push(
      collectModelOutputFeedback(
        `Add .returns({ type: "object", properties: { ${returnsProp}: { type: "object" } }, required: ["${returnsProp}"] }) before .run().`
      )
    )
  }

  if (acceptsProp && acceptsNames.includes(acceptsProp) && !stepUsesAcceptsRef(manifest, acceptsProp)) {
    feedback.push(
      collectModelOutputFeedback(
        `Wire run input with ref("${acceptsProp}") in step .with({ ... }), not ref("step.output").`
      )
    )
  }

  if (/\bno\s+returns?\b/i.test(lower) && returnsNames.length > 0) {
    feedback.push(collectModelOutputFeedback("Omit .returns({...}) for this workflow."))
  }

  return feedback.length > 0 ? feedback : undefined
}

/**
 * Map common Fluent compile errors to repair hints.
 * @category Harness
 */
export function collectFluentCompileErrorFeedback(
  compileMessage: string
): HarnessOperationFeedback[] | undefined {
  const lower = compileMessage.toLowerCase()
  if (
    lower.includes("failed to resolve module specifier") ||
    lower.includes("__ecpworkflowshim") ||
    (lower.includes("cannot find module") && lower.includes("@executioncontrolprotocol"))
  ) {
    return [
      collectModelOutputFeedback(
        'Keep a single named import from "@executioncontrolprotocol/core" only ' +
          "(workflow, step, ref, branch, parallel, loop as needed). " +
          "Do not import other packages, relative paths, or @executioncontrolprotocol/browser for Fluent APIs. " +
          "Example: import { workflow, step, ref } from \"@executioncontrolprotocol/core\""
      ),
    ]
  }
  if (lower.includes("ref is not defined")) {
    return [
      collectModelOutputFeedback(
        'Add ref to the import: import { workflow, step, ref } from "@executioncontrolprotocol/core".'
      ),
    ]
  }
  if (
    lower.includes("is not a function") ||
    lower.includes("is not defined") ||
    lower.includes("typescript")
  ) {
    return [
      collectModelOutputFeedback(
        "Use only @executioncontrolprotocol/core Fluent API: workflow, step, ref, branch, parallel, loop. " +
          "Never use identifiers named typescript, moveStep, UPDATE STEP, or chained .remove() / .after(). " +
          FLUENT_ANTI_PATTERNS
      ),
    ]
  }
  return undefined
}
