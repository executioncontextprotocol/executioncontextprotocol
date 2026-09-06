import { ECP_HARNESS_REPLY_SCHEMA, ECP_INTENT_SCHEMA } from "@executioncontrolprotocol/types"

const INTENT_TEMPLATE = `import type { EcpIntent } from "@executioncontrolprotocol/types"

export const intent: EcpIntent = {
  schema: "@executioncontrolprotocol.intent",
  intent: "faq",
}`

const REPLY_TEMPLATE = `import type { HarnessReply } from "@executioncontrolprotocol/types"

export const reply: HarnessReply = {
  schema: "@executioncontrolprotocol.harness.reply",
  answer: "Your answer here.",
}`

const WORKFLOW_TEMPLATE = `import { workflow, step, ref } from "@executioncontrolprotocol/core"

export default workflow("Echo from input")
  .id("echo-from-input")
  .accepts({
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
  })
  .returns({
    type: "object",
    properties: { echo: { type: "object" } },
    required: ["echo"],
  })
  .run([
    step("@executioncontrolprotocol/test.echo", "Echo").id("echo").with({ value: ref("value") }).as("echo"),
  ])`

/**
 * Minimal TypeScript output template for a harness output schema.
 * @category Harness
 */
export function typescriptTemplateForOutputSchema(outputSchema: string): string {
  if (outputSchema === ECP_INTENT_SCHEMA) return INTENT_TEMPLATE
  if (outputSchema === ECP_HARNESS_REPLY_SCHEMA) return REPLY_TEMPLATE
  if (outputSchema === "@executioncontrolprotocol.workflow") return WORKFLOW_TEMPLATE
  return `// Export a valid ${outputSchema} document from this module`
}

/**
 * Instructions for TypeScript-only harness model output.
 * @category Harness
 */
export function typescriptPrimerForOutputSchema(outputSchema: string): string {
  const workflowApi =
    outputSchema === "@executioncontrolprotocol.workflow"
      ? [
          "Allowed @executioncontrolprotocol/core imports: workflow, step, ref, branch, parallel, loop.",
          "Use .id(\"stepId\") on steps when ids must stay stable across edits.",
          "Chain .accepts({...}) and .returns({...}) before .run() for workflow I/O schemas.",
          "Wire accepts keys with ref(\"key\") — not ref(\"step.output\") for run input.",
          ".as(\"key\") stores the entire capability output under state.key.",
          "A .returns property that maps to an .as key must match that capability output type.",
          "Model *.generate outputs are objects with text — type returns as object (not string); chain with ref(\"prior.text\").",
          "Never output the word typescript on its own line before imports.",
        ]
      : []
  return [
    "Reply with TypeScript source only.",
    "No markdown fences. No JSON-only blobs. No prose outside code.",
    `Output must satisfy schema ${outputSchema}.`,
    ...workflowApi,
    "Template:",
    typescriptTemplateForOutputSchema(outputSchema),
  ].join("\n")
}
