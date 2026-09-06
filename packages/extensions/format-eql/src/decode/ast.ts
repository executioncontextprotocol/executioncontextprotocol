import type { ExprValue, InputValue } from "@executioncontrolprotocol/types"

export interface EqlHeader {
  schema: string
  version: string
}

export interface EqlWorkflowDoc {
  kind: "workflow"
  header?: EqlHeader
  workflowId: string
  workflowLabel?: string
  accepts?: Record<string, string>
  returns?: Record<string, string>
  steps: EqlStep[]
}

export interface EqlStep {
  id: string
  uses: string
  label?: string
  with: Record<string, InputValue>
  as?: string
  mode?: string
  when?: ExprValue
}

export interface EqlWorkflowUpdate {
  label?: string
  accepts?: Record<string, string>
  returns?: Record<string, string>
  clearAccepts?: boolean
  clearReturns?: boolean
}

export interface EqlPatchDoc {
  kind: "patch"
  header?: EqlHeader
  workflowId: string
  workflowUpdate?: EqlWorkflowUpdate
  updates: EqlStepUpdate[]
  adds: EqlStepAdd[]
  deletes: string[]
  moves: EqlStepMove[]
}

export interface EqlStepUpdate {
  stepId: string
  label?: string
  uses?: string
  with: Record<string, InputValue>
  as?: string
  mode?: string
  when?: ExprValue
}

export interface EqlStepAdd {
  stepId: string
  uses: string
  after?: string
  before?: string
  label?: string
  with: Record<string, InputValue>
  as?: string
  mode?: string
  when?: ExprValue
}

export interface EqlStepMove {
  stepId: string
  after?: string
  before?: string
}

export interface EqlEnvironmentDoc {
  kind: "environment"
  header?: EqlHeader
  environmentId: string
  environmentLabel?: string
  runtime?: {
    id: string
    label?: string
    config: Record<string, unknown>
  }
  extensions: EqlBinding[]
  policies: EqlBinding[]
}

export interface EqlBinding {
  id: string
  order: number
  label?: string
  config: Record<string, unknown>
}

export interface EqlDescribeDoc {
  kind: "describe"
  header?: EqlHeader
  environmentId: string
  environmentLabel?: string
  runtime?: {
    id: string
    label?: string
    features: Record<string, boolean>
  }
  extensions: EqlDescribeExtension[]
  capabilities: EqlDescribeCapability[]
  policies: EqlDescribePolicy[]
}

export interface EqlDescribeExtension {
  id: string
  order: number
  label?: string
  capabilities: string[]
}

export interface EqlDescribeCapability {
  id: string
  extension?: string
  label?: string
  inputs: Record<string, string>
  outputs: Record<string, string>
}

export interface EqlDescribePolicy {
  id: string
  label?: string
  summary?: string
}

export interface EqlIntentDoc {
  kind: "intent"
  header?: EqlHeader
  intent: string
  /** Optional topic bucket. */
  topic?: string
  /** Optional request summary. */
  summary?: string
}

export interface EqlReplyCitation {
  kind: string
  id?: string
  detail?: string
}

export interface EqlReplyDoc {
  kind: "reply"
  header?: EqlHeader
  answer: string
  citations: EqlReplyCitation[]
  /** Optional suggested UI action (e.g. offer-run). */
  suggestedAction?: string
}

export type EqlDocument =
  | EqlWorkflowDoc
  | EqlPatchDoc
  | EqlEnvironmentDoc
  | EqlDescribeDoc
  | EqlIntentDoc
  | EqlReplyDoc

export interface ParsedLine {
  line: number
  indent: number
  text: string
  tokens: string[]
}
