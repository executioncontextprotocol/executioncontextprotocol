import type { RunStatus } from "./schema.js"
import type { EcpVersion } from "./version.js"
import type { MutationRecord } from "./store.js"
import type { WorkflowManifest } from "./workflow.js"
import type { ValidationIssue } from "./validation.js"

/** Run request document. @category Runtime */
export interface RunRequest {
  schema: "@executioncontrolprotocol.run.request"
  version: EcpVersion
  workflow: WorkflowManifest
  input?: Record<string, unknown>
  actor?: Record<string, unknown>
  dryRun?: boolean
}

/** Per-step run history record. @category Runtime */
export interface StepRunRecord {
  status: RunStatus
  output?: unknown
  committedAs?: string | null
  attempts?: number
  usage?: Record<string, unknown>
  mutations?: MutationRecord[]
  /** Failure diagnostics when the step did not complete. */
  diagnostics?: ValidationIssue[]
}

/** Run result document. @category Runtime */
export interface RunResult {
  schema: "@executioncontrolprotocol.run.result"
  version: EcpVersion
  run: {
    id: string
    status: RunStatus
  }
  state?: Record<string, unknown>
  /**
   * Public output picked from state using `workflow.returns` property names.
   * Present when the workflow declares `returns` and the run completed (or when
   * a returns object was assembled before a validation failure).
   */
  output?: Record<string, unknown>
  history?: Record<string, StepRunRecord>
  usage?: Record<string, unknown>
  /**
   * Run-level diagnostics (e.g. `workflow.returns` validation after steps completed).
   */
  diagnostics?: ValidationIssue[]
}
