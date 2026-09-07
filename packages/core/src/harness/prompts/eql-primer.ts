/** Shared EQL language primer blocks for harness system prompts. @internal */

export const EQL_ZERO_KNOWLEDGE_INTRO = [
  "Here is a workflow query language called EQL (Execution Query Language).",
  "You have no prior knowledge of EQL — follow the grammar and examples below exactly.",
  "",
  "Global rules:",
  "- Output EQL text only. No markdown fences, no JSON, no prose before or after.",
  "- No ECP header line (no @executioncontrolprotocol.patch / @executioncontrolprotocol.workflow header in model output).",
  "- One keyword per line; indent child fields with two spaces under STEP / UPDATE / ADD / REPLY.",
  "- Capability ids are exact strings from the environment list (e.g. @executioncontrolprotocol/chrome-ai.generate). Never invent ids.",
  "- Literals: \"strings\", numbers, true/false, {\"json\": \"objects\"}.",
  "- REF path reads a prior step output (e.g. REF poem.text). Use only step ids that exist in the workflow.",
  "- Examples teach syntax only. Output only what the current user request asks for.",
  "- Never copy example workflow ids, step ids, or field values unless the user request matches that example.",
  "- PATCH WORKFLOW id must always match the workflow id from the user prompt, not an example id.",
  "- Every @executioncontrolprotocol.patch output MUST begin with: PATCH WORKFLOW <workflowId>",
].join("\n")

export const EQL_VALUE_EXPRESSIONS = [
  "Value expressions (right-hand side of WITH name = …):",
  "- \"literal string\"",
  "- 42 or true or false",
  "- {\"field\": \"value\"} JSON object",
  "- REF <acceptsKey> — read workflow run input (accepts property seeds state.<key>)",
  "- REF <stepId>.output — reference another step's output (chain steps this way)",
  "- REF <asKey>.text — read nested fields on a prior AS value (e.g. model *.generate output has text)",
].join("\n")

export const EQL_WORKFLOW_IO = [
  "Workflow I/O (@executioncontrolprotocol.workflow):",
  "- ACCEPTS block declares run input fields (type declarations, not assignments):",
  "    WITH <fieldName>:<type>[!]",
  "- RETURNS block declares workflow output fields:",
  "    OUT <fieldName>:<type>[!]",
  "- Types: string, number, integer, boolean, object, array, file, unknown",
  "- Suffix ! marks required fields (e.g. prompt:string!)",
  "- Place ACCEPTS / RETURNS after WORKFLOW line and before STEP lines.",
  "- AS <key> stores the entire capability output under state.<key>.",
  "- A RETURNS OUT field that maps to an AS key must match that capability output type.",
  "- Model *.generate outputs are objects with text — use OUT <key>:object!, never string.",
].join("\n")

export const EQL_WORKFLOW_OPERATIONS = [
  "Supported operations (@executioncontrolprotocol.workflow):",
  "- WORKFLOW <id> [\"optional label\"]",
  "- ACCEPTS / RETURNS typed-field blocks (see workflow I/O rules above)",
  "- STEP <stepId> USES <capabilityId>",
  "    LABEL \"Human label\"",
  "    WITH <inputField> = <value expression>",
  "    AS <stateKey>",
  "- Repeat STEP for each step in order. stepId is a short name (poem), not a capability id.",
  "- Each STEP must have a unique stepId. Reusing the same capabilityId on multiple steps still requires distinct ids (poem, summarize — not generate twice).",
].join("\n")

export const EQL_PATCH_OPERATIONS = [
  "EQL patch verb model (PATCH opens the document; UPDATE/ADD/DELETE/MOVE mutate):",
  "- PATCH WORKFLOW <workflowId>  — required first line; names the target workflow (not a field change)",
  "- UPDATE WORKFLOW  — change workflow metadata on that target",
  "    LABEL \"new workflow label\"",
  "    ACCEPTS",
  "      WITH <fieldName>:<type>[!]",
  "    RETURNS",
  "      OUT <fieldName>:<type>[!]",
  "    CLEAR ACCEPTS",
  "    CLEAR RETURNS",
  "- UPDATE STEP <stepId>  — change fields on an existing step",
  "    LABEL \"new step label\"",
  "    WITH <field> = <value expression>",
  "    USES <capabilityId>",
  "    AS <stateKey>",
  "- DELETE STEP <stepId>  — remove an existing step",
  "- ADD STEP <newStepId> USES <capabilityId> AFTER|BEFORE <existingStepId>  — insert a new step",
  "    LABEL \"…\"",
  "    WITH <field> = <value expression>",
  "    AS <stateKey>",
  "- MOVE STEP <stepId> AFTER|BEFORE <anchorStepId>  — reorder an existing step",
  "",
  "Choosing the right operation:",
  "- Request changes the workflow label (not a step) → UPDATE WORKFLOW with LABEL. Do not UPDATE STEP.",
  "- Step id listed under Existing step ids → already in the workflow.",
  "    Change it with UPDATE STEP. Remove it with DELETE STEP. Never ADD STEP with that same id.",
  "- Request says remove or delete a step → DELETE STEP <id> only (no UPDATE, no ADD).",
  "- Request changes a step label or input → UPDATE STEP only (no ADD).",
  "- Request adds a capability not yet in the workflow → ADD STEP with a new step id.",
  "- Request asks for multiple changes → output every required operation (e.g. DELETE then ADD).",
  "",
  "Patch semantics (critical):",
  "- Output only PATCH / UPDATE / DELETE / ADD / MOVE lines. Do NOT re-emit unchanged steps as STEP lines.",
  "- ADD STEP inserts a new step; all existing steps remain unless you DELETE STEP them.",
  "- UPDATE and DELETE target step ids that already exist in the workflow summary.",
].join("\n")

export const EQL_PATCH_CANONICAL_EXAMPLES = [
  "Examples (each shows one operation type — combine only when the user request requires it):",
  "",
  "Example 1 — UPDATE WORKFLOW label (workflow metadata, not a step):",
  "User: Change workflow label to Updated Chain.",
  "Output:",
  "PATCH WORKFLOW poem-summarize",
  "UPDATE WORKFLOW",
  "  LABEL \"Updated Chain\"",
  "",
  "Example 2 — UPDATE STEP label on an existing step (not ADD):",
  "User: Change summarize step label to Short Summary.",
  "Output:",
  "PATCH WORKFLOW poem-summarize",
  "UPDATE STEP summarize",
  "  LABEL \"Short Summary\"",
  "",
  "Example 3 — ADD STEP after an existing step (new step id only):",
  "User: Add an explain step after poem using @executioncontrolprotocol/chrome-ai.generate.",
  "Output:",
  "PATCH WORKFLOW poem-only",
  "ADD STEP explain USES @executioncontrolprotocol/chrome-ai.generate AFTER poem",
  "  LABEL \"Explain\"",
  "  WITH prompt = \"Explain what this means.\"",
  "  WITH context = REF poem.text",
  "  AS explanation",
  "",
  "Example 4 — UPDATE STEP to wire a ref between existing steps:",
  "User: Ensure summarize context references poem text.",
  "Output:",
  "PATCH WORKFLOW poem-summarize",
  "UPDATE STEP summarize",
  "  WITH context = REF poem.text",
  "",
  "Example 5 — multiple operations in one patch:",
  "User: Add actions after email and remove summarize if present.",
  "Output:",
  "PATCH WORKFLOW email-action",
  "DELETE STEP summarize",
  "ADD STEP actions USES @executioncontrolprotocol/chrome-ai.generate AFTER email",
  "  LABEL \"Extract Action Items\"",
  "  WITH prompt = \"Extract the key action items from the following email:\"",
  "  WITH context = REF email.text",
  "  AS actions",
  "",
  "Example 6 — DELETE STEP:",
  "User: Remove the actions step from the workflow",
  "Output:",
  "PATCH WORKFLOW email-action",
  "DELETE STEP actions",
  "",
  "Example 7 — MOVE STEP reorder:",
  "User: Move the explain step to run after haiku.",
  "Output:",
  "PATCH WORKFLOW haiku-explain",
  "MOVE STEP explain AFTER haiku",
].join("\n")

export const EQL_WORKFLOW_PRIMER = [
  EQL_ZERO_KNOWLEDGE_INTRO,
  "",
  EQL_WORKFLOW_IO,
  "",
  EQL_WORKFLOW_OPERATIONS,
  "",
  EQL_VALUE_EXPRESSIONS,
].join("\n")

export const EQL_PATCH_PRIMER = [
  EQL_ZERO_KNOWLEDGE_INTRO,
  "",
  EQL_WORKFLOW_IO,
  "",
  EQL_PATCH_OPERATIONS,
  "",
  EQL_VALUE_EXPRESSIONS,
  "",
  EQL_PATCH_CANONICAL_EXAMPLES,
].join("\n")

export const EQL_INTENT_PRIMER = [
  EQL_ZERO_KNOWLEDGE_INTRO,
  "",
  "Intent (@executioncontrolprotocol.intent) grammar:",
  "- INTENT <value> [TOPIC <topic>] [SUMMARY \"one-line paraphrase\"]",
  "- Or multi-line: INTENT <value> then indented TOPIC and SUMMARY lines",
  "- <value> must be one of the allowed intent strings from the fixture.",
  "- TOPIC and SUMMARY are optional but help downstream contextualized shots.",
].join("\n")

export const EQL_REPLY_PRIMER = [
  EQL_ZERO_KNOWLEDGE_INTRO,
  "",
  "Reply (@executioncontrolprotocol.harness.reply) grammar:",
  "- REPLY",
  "    ANSWER \"plain text answer\"",
  "    CITATION step <stepId> [\"optional detail\"]",
  "    CITATION extension <extensionId> [\"optional detail\"]",
  "- ANSWER is required. Use straight double quotes around answer text.",
].join("\n")

/** Pick the EQL primer for a harness output schema id. */
export function eqlPrimerForOutputSchema(outputSchema: string): string {
  switch (outputSchema) {
    case "@executioncontrolprotocol.patch":
      return EQL_PATCH_PRIMER
    case "@executioncontrolprotocol.workflow":
      return EQL_WORKFLOW_PRIMER
    case "@executioncontrolprotocol.intent":
      return EQL_INTENT_PRIMER
    case "@executioncontrolprotocol.harness.reply":
      return EQL_REPLY_PRIMER
    default:
      return EQL_ZERO_KNOWLEDGE_INTRO
  }
}
