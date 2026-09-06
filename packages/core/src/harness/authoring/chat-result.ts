import {
  ECP_HARNESS_REPLY_ACTIONS,
  ECP_HARNESS_REPLY_SCHEMA,
  type EcpHarnessReplyAction,
  type HarnessEvaluateOutput,
  type HarnessReply,
  type WorkflowManifest,
} from "@executioncontrolprotocol/types"

const WORKFLOW_SCHEMA = "@executioncontrolprotocol.workflow"

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}

function isWorkflowManifest(value: unknown): value is WorkflowManifest {
  return (
    isRecord(value) &&
    value.schema === WORKFLOW_SCHEMA &&
    isRecord(value.workflow)
  )
}

function isHarnessReply(value: unknown): value is HarnessReply {
  return (
    isRecord(value) &&
    value.schema === ECP_HARNESS_REPLY_SCHEMA &&
    typeof value.answer === "string"
  )
}

/**
 * Extract assistant answer text from a chat harness result when applicable.
 * @category Harness
 */
export function chatResultAnswer(result: HarnessEvaluateOutput): string | undefined {
  if (isHarnessReply(result.artifact)) {
    return result.artifact.answer
  }
  return undefined
}

/**
 * Extract authored workflow from a chat harness result.
 * Prefers the sidecar {@link HarnessEvaluateOutput.workflow}; falls back to a
 * legacy workflow-as-artifact shape for older callers.
 * @category Harness
 */
export function chatResultWorkflow(result: HarnessEvaluateOutput): WorkflowManifest | undefined {
  if (isWorkflowManifest(result.workflow)) {
    return result.workflow
  }
  if (isWorkflowManifest(result.artifact)) {
    return result.artifact
  }
  return undefined
}

/**
 * Extract suggested UI action from a chat harness reply artifact.
 * @category Harness
 */
export function chatResultSuggestedAction(
  result: HarnessEvaluateOutput
): EcpHarnessReplyAction | undefined {
  if (!isHarnessReply(result.artifact)) {
    return undefined
  }
  const action = result.artifact.suggestedAction
  if (action === ECP_HARNESS_REPLY_ACTIONS.OFFER_RUN) {
    return action
  }
  return undefined
}
