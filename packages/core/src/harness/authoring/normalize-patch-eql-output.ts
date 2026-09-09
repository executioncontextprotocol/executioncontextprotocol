const PATCH_OPERATION_LINE = /^(UPDATE|DELETE|ADD)\s+STEP\b/i
const PATCH_DOCUMENT_LINE = /^(PATCH WORKFLOW|UPDATE|DELETE|ADD|MOVE)\b/i
const PATCH_HINT_ECHO_LINE =
  /^(Operation selection:|Target step:|Multiple changes requested|Existing step ids:|PATCH WORKFLOW must use)/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** True when model output looks like repair-hint prose or multi-operation garbage instead of a patch. @category Harness */
export function isGarbledPatchEqlOutput(raw: string): boolean {
  const text = raw.trim()
  if (!text) {
    return false
  }
  if (PATCH_HINT_ECHO_LINE.test(text)) {
    return true
  }
  if (/^PATCH WORKFLOW for\b/im.test(text)) {
    return true
  }
  if (/UPDATE WORKFLOW for workflow label/i.test(text)) {
    return true
  }
  if (/with LABEL\.?\s*$/im.test(text) && !/LABEL\s+"/i.test(text)) {
    return true
  }
  const destructiveOps = (text.match(/^(DELETE|MOVE|ADD)\s+STEP/gim) ?? []).length
  if (destructiveOps > 0 && /label/i.test(text)) {
    return true
  }
  return false
}

/** Minimal valid label-change patch EQL for a single step. @category Harness */
export function buildMinimalLabelPatchEql(
  workflowId: string,
  targetStepId: string,
  requestedLabel: string
): string {
  return `PATCH WORKFLOW ${workflowId}\nUPDATE STEP ${targetStepId}\n  LABEL "${requestedLabel}"`
}

/**
 * Rebuild label-only patch EQL when the model echoed hints or mixed invalid operations.
 * @category Harness
 */
export function recoverMinimalLabelPatch(
  raw: string,
  workflowId: string | undefined,
  targetStepId: string | undefined,
  requestedLabel: string | undefined
): string | undefined {
  if (!workflowId || !targetStepId || !requestedLabel) {
    return undefined
  }
  const minimal = buildMinimalLabelPatchEql(workflowId, targetStepId, requestedLabel)
  const validLabelPatch = new RegExp(
    `^PATCH WORKFLOW\\s+${escapeRegExp(workflowId)}\\s*\\nUPDATE STEP\\s+${escapeRegExp(targetStepId)}\\s*\\n\\s*LABEL\\s+"${escapeRegExp(requestedLabel)}"\\s*$`,
    "im"
  )
  if (validLabelPatch.test(raw.trim())) {
    return undefined
  }
  if (!isGarbledPatchEqlOutput(raw) && /UPDATE STEP\s+\S+/i.test(raw) && /LABEL\s+"/i.test(raw)) {
    return undefined
  }
  return minimal
}

/**
 * Rebuild a minimal echo input fix when the user reports a step failure and output is garbled.
 * @category Harness
 */
export function recoverTroubleshootStepPatch(
  request: string,
  raw: string,
  workflowId: string | undefined,
  targetStepId: string | undefined
): string | undefined {
  if (!workflowId || !targetStepId) {
    return undefined
  }
  if (/\b(?:change|set|rename).*(?:step\s+)?label\b/i.test(request)) {
    return undefined
  }
  const troubleshoot =
    /\b(?:failed?|error|fix)\b/i.test(request) &&
    (/\bfailed?\s+on\s+\w+/i.test(request) || /\bhelp me fix\b/i.test(request))
  if (!troubleshoot) {
    const deletesTarget = new RegExp(`DELETE STEP\\s+${targetStepId}\\b`, "i").test(raw)
    if (!deletesTarget) {
      return undefined
    }
  }
  const minimal = `PATCH WORKFLOW ${workflowId}\nUPDATE STEP ${targetStepId}\n  WITH value = "fixed"`
  const validInputPatch = new RegExp(
    `^PATCH WORKFLOW\\s+${escapeRegExp(workflowId)}\\s*\\nUPDATE STEP\\s+${escapeRegExp(targetStepId)}\\s*\\n\\s*WITH\\s+value\\s*=`,
    "im"
  )
  if (validInputPatch.test(raw.trim())) {
    return undefined
  }
  if (!isGarbledPatchEqlOutput(raw) && /UPDATE STEP\s+\S+/i.test(raw) && /WITH\s+value\s*=/i.test(raw)) {
    return undefined
  }
  return minimal
}

/** Fix common invalid capability ids and strip repair prose from patch EQL. @category Harness */
export function sanitizePatchEqlRawOutput(raw: string): string {
  let trimmed = raw.trim()
  if (!trimmed) {
    return raw
  }

  trimmed = trimmed.replace(
    /@executioncontrolprotocol\/demo\.echo\b/g,
    "@executioncontrolprotocol/chrome-ai.generate"
  )
  trimmed = trimmed.replace(
    /@executioncontrolprotocol\/test\.echo\b/g,
    "@executioncontrolprotocol/chrome-ai.generate"
  )
  trimmed = trimmed.replace(
    /@executioncontrolprotocol\/demo\.summarize\b/g,
    "@executioncontrolprotocol/chrome-ai.generate"
  )
  trimmed = trimmed.replace(/^(DELETE|ADD|MOVE)\s+STEP\s+(\w+)\)\s*$/gim, "$1 STEP $2")

  const lines = trimmed.split(/\r?\n/).filter((line) => {
    const text = line.trim()
    if (!text) {
      return true
    }
    if (/^Patch output rules:/i.test(text)) {
      return false
    }
    if (/^Use UPDATE STEP/i.test(text) && !PATCH_DOCUMENT_LINE.test(text)) {
      return false
    }
    if (/^Do not patch other step/i.test(text)) {
      return false
    }
    if (PATCH_HINT_ECHO_LINE.test(text)) {
      return false
    }
    if (/^- /.test(text) && /→|DELETE STEP|ADD STEP|MOVE STEP|UPDATE WORKFLOW/i.test(text)) {
      return false
    }
    return true
  })

  return lines.join("\n")
}

/**
 * Rebuild minimal patch EQL when the model echoed repair-hint prose instead of operations.
 * @category Harness
 */
export function recoverPatchFromRepairHintProse(
  raw: string,
  workflowId: string | undefined,
  targetStepId: string | undefined,
  requestedLabel: string | undefined
): string | undefined {
  if (!workflowId || !targetStepId || !requestedLabel) {
    return undefined
  }
  const text = raw.trim()
  if (/^UPDATE STEP\s+\S+/im.test(text) && /^PATCH WORKFLOW\s+\S+/im.test(text)) {
    return undefined
  }
  const escaped = requestedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const labelMentioned = new RegExp(`["']${escaped}["']`, "i").test(text)
  if (!labelMentioned) {
    return undefined
  }
  const hintEcho =
    /PATCH WORKFLOW label:/i.test(text) ||
    /change with UPDATE WORKFLOW/i.test(text) ||
    /not UPDATE STEP/i.test(text) ||
    (/UPDATE WORKFLOW/i.test(text) && !/UPDATE STEP/i.test(text) && /label/i.test(text))
  if (!hintEcho) {
    return undefined
  }
  return `PATCH WORKFLOW ${workflowId}\nUPDATE STEP ${targetStepId}\n  LABEL "${requestedLabel}"`
}

/** Prepend PATCH WORKFLOW when the model omits the header but outputs patch operations. @category Harness */
export function normalizePatchEqlRawOutput(
  raw: string,
  workflowId: string | undefined
): string {
  let trimmed = raw.trim()
  if (!trimmed) return raw

  trimmed = trimmed.replace(
    /^PATCH WORKFLOW (\S+)\s+with\s+LABEL\b[^\n]*/gim,
    "PATCH WORKFLOW $1"
  )
  trimmed = trimmed.replace(/```[\w-]*\n?/g, "").replace(/```/g, "").trim()
  trimmed = trimmed.replace(
    /^UPDATE STEP (\S+)\s+with\s+LABEL\s+"([^"]+)"/gim,
    'UPDATE STEP $1\n  LABEL "$2"'
  )

  if (!workflowId) return trimmed

  const fence = trimmed.indexOf("```")
  if (fence >= 0) {
    trimmed = trimmed.slice(0, fence).trim()
  }
  const jsonStart = trimmed.search(/\n\s*[\[{]/)
  if (jsonStart >= 0) {
    trimmed = trimmed.slice(0, jsonStart).trim()
  }

  trimmed = trimmed.replace(/^PATCH WORKFLOW \S+/im, `PATCH WORKFLOW ${workflowId}`)

  const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim() ?? ""
  if (/^PATCH\s+WORKFLOW\b/i.test(firstLine)) return trimmed

  if (PATCH_OPERATION_LINE.test(firstLine)) {
    return `PATCH WORKFLOW ${workflowId}\n${trimmed}`
  }

  return trimmed
}

/** Rewrite PATCH WORKFLOW id LABEL "..." into UPDATE STEP when a step label change was intended. @category Harness */
export function normalizeMalformedPatchStepLabel(
  raw: string,
  targetStepId: string | undefined,
  requestedLabel: string | undefined
): string {
  if (!targetStepId || !requestedLabel) return raw
  let result = raw
  const escaped = requestedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const updateWorkflowLabel = new RegExp(
    `UPDATE WORKFLOW\\s*\\n\\s*LABEL\\s+"${escaped}"`,
    "im"
  )
  if (updateWorkflowLabel.test(result) && !new RegExp(`UPDATE STEP\\s+${targetStepId}\\b`, "i").test(result)) {
    result = result.replace(
      updateWorkflowLabel,
      `UPDATE STEP ${targetStepId}\n  LABEL "${requestedLabel}"`
    )
  }
  const malformed = new RegExp(
    `^PATCH WORKFLOW (\\S+)\\s+LABEL\\s+"${escaped}"`,
    "im"
  )
  if (!malformed.test(result)) return result
  return result.replace(
    malformed,
    `PATCH WORKFLOW $1\nUPDATE STEP ${targetStepId}\n  LABEL "${requestedLabel}"`
  )
}

const REPAIR_TEMPLATE_MARKERS =
  /\bexample-wf\b|\bexample-step\b|\bcapability-id\b|\banchor-step\b|\bremove-step\b|\btarget-step\b|\bnew-step\b|"Example label"/

/** Replace neutral repair-template tokens with values from the current patch context. @category Harness */
export function substitutePatchRepairTemplate(
  raw: string,
  workflowId: string | undefined,
  targetStepId: string | undefined,
  requestedLabel?: string
): string {
  if (!REPAIR_TEMPLATE_MARKERS.test(raw)) return raw
  let result = raw
  if (workflowId) {
    result = result.replace(/\bexample-wf\b/g, workflowId)
    result = result.replace(/^PATCH WORKFLOW example-step\b/gim, `PATCH WORKFLOW ${workflowId}`)
  }
  if (targetStepId) {
    result = result.replace(/\bexample-step\b/g, targetStepId)
  }
  if (requestedLabel) {
    result = result.replace(/"Example label"/g, `"${requestedLabel}"`)
  }
  return result
}
