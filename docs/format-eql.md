# ECP EQL format

Agreed on all three changes. Here’s the revised implementation plan delta.

## Updated decisions

## 1. Patch language should use `WITH x = value`, not `SET WITH.x`

I agree. `SET WITH.x` feels like a leaky patch syntax. It exposes the internal operation instead of preserving the same authoring language.

Use the same verbs as Fluent/manifest concepts:

```eql
PATCH WORKFLOW weekly_brief

UPDATE STEP generate_brief
  LABEL "Generate Executive Brief"
  WITH prompt = "Create a tighter executive brief."
  WITH context = REF signals.results
  AS brief MODE replace
```

This is cleaner because `WITH` maps directly to `.with(...)`, `AS` maps to `.as(...)`, and `MODE` maps to `commitMode`. The existing workflow model already has `step(...).with(input).as(key?)`, and workflow state commits are represented through `.as()` / `commitAs`.

## 2. Remove `compact` from v1

Agreed. Keep v1 focused on reliability and round-tripping.

Remove this from v1:

```ts
compact?: boolean
```

Keep only:

```ts
export interface EqlFormatOptions {
  header?: boolean;        // default true
  preserveIds?: boolean;   // default true
  quote?: "auto" | "always";
  indent?: number;         // default 2
}
```

Descriptor compression can be v2. For v1, the core need is:

```txt
@executioncontrolprotocol.workflow JSON ↔ EQL
@executioncontrolprotocol.patch JSON ↔ EQL
```

## 3. Keep browser demo out of scope

Agreed. No browser demo work in this plan.

The package can still be usable by browser/runtime contexts later, but v1 implementation should focus on harness/eval quality and extension-level encode/decode support.

---

# Revised `@executioncontrolprotocol/format-eql` implementation plan

## Package

```txt
packages/extensions/format-eql/
  src/
    index.ts
    extension.ts
    schemas.ts
    encode/
      encode-workflow.ts
      encode-patch.ts
      writer.ts
    decode/
      decode-workflow.ts
      decode-patch.ts
      lexer.ts
      parser.ts
      ast.ts
      normalize.ts
      diagnostics.ts
    __tests__/
      encode-workflow.test.ts
      decode-workflow.test.ts
      roundtrip.test.ts
      patch.test.ts
      header.test.ts
```

Published as:

```txt
@executioncontrolprotocol/format-eql
```

Extension ID:

```txt
@executioncontrolprotocol/format-eql
```

Capabilities:

```txt
@executioncontrolprotocol/format-eql.encode
@executioncontrolprotocol/format-eql.decode
```

---

# Standard built-in capability interfaces

This is a very good point and should be captured separately, even if the format package only consumes it.

The pattern should be:

```ts
// from @executioncontrolprotocol/types
export interface EncodeCapabilityInput<TValue = unknown> {
  value: TValue;
  from?: EcpSchema | string;
  options?: Record<string, unknown>;
}

export interface EncodeCapabilityOutput {
  text: string;
  contentType?: string;
  schema?: EcpSchema | string;
  diagnostics?: CapabilityDiagnostic[];
}

export interface DecodeCapabilityInput {
  text: string;
  to: EcpSchema | string;
  options?: Record<string, unknown>;
}

export interface DecodeCapabilityOutput<TValue = unknown> {
  value: TValue;
  schema?: EcpSchema | string;
  diagnostics?: CapabilityDiagnostic[];
}
```

Then `format-eql` extends the minimum interface:

```ts
export interface EqlEncodeInput<TValue = unknown>
  extends EncodeCapabilityInput<TValue> {
  options?: EqlFormatOptions;
}

export interface EqlDecodeInput
  extends DecodeCapabilityInput {
  options?: EqlFormatOptions;
}
```

Same principle should apply to generation and evaluation:

```ts
export interface GenerateCapabilityInput {
  prompt: string;
  system?: string;
  context?: unknown;
  options?: Record<string, unknown>;
}

export interface GenerateCapabilityOutput {
  text: string;
  raw?: unknown;
  usage?: unknown;
  diagnostics?: CapabilityDiagnostic[];
}

export interface EvaluateCapabilityInput {
  subject: unknown;
  criteria?: unknown;
  rubric?: unknown;
  options?: Record<string, unknown>;
}

export interface EvaluateCapabilityOutput {
  passed?: boolean;
  score?: number;
  result?: unknown;
  rationale?: string;
  diagnostics?: CapabilityDiagnostic[];
}
```

Extension implementers can extend these with provider-specific fields:

```ts
export interface OpenAIGenerateInput
  extends GenerateCapabilityInput {
  model?: string;
  temperature?: number;
}
```

That gives ECP a stable minimum contract while preserving extension flexibility.

This fits the existing capability pattern where capabilities define input/output schemas and handlers through the definition builder.

---

# Revised EQL workflow syntax

## Create workflow

```eql
ECP @executioncontrolprotocol.workflow 1.0

WORKFLOW weekly_brief "Weekly leadership brief"

STEP collect_signals USES @executioncontrolprotocol/memory.search
  LABEL "Collect Weekly Signals"
  WITH query = "important risks and decisions this week"
  WITH since = "7d"
  AS signals

STEP generate_brief USES @executioncontrolprotocol/openai.generate
  LABEL "Generate Executive Brief"
  WITH prompt = "Create a concise leadership brief."
  WITH context = REF signals.results
  AS brief

STEP send_brief USES @executioncontrolprotocol/slack.send
  LABEL "Send Brief to Slack"
  WITH message = REF brief.content
```

## No header mode

```eql
WORKFLOW weekly_brief "Weekly leadership brief"

STEP collect_signals USES @executioncontrolprotocol/memory.search
  WITH query = "important risks and decisions this week"
  AS signals
```

When `header: false`, encoder omits:

```eql
ECP @executioncontrolprotocol.workflow 1.0
```

Decoder accepts both forms. If the header is omitted, `to` must be provided through the standard decode input.

---

# Revised patch syntax

## Patch workflow

```eql
PATCH WORKFLOW weekly_brief

UPDATE STEP generate_brief
  LABEL "Generate Executive Brief"
  WITH prompt = "Create a tighter executive brief."
  WITH context = REF signals.results
  AS brief MODE replace

ADD STEP send_email AFTER generate_brief USES @executioncontrolprotocol/email.send
  LABEL "Send Email"
  WITH subject = "Weekly brief"
  WITH body = REF brief.content

DELETE STEP old_notify

MOVE STEP send_email AFTER generate_brief
```

## Why this is better

The patch syntax now uses the same verbs as workflow creation:

| Create syntax     | Patch syntax      | Canonical field |
| ----------------- | ----------------- | --------------- |
| `LABEL "x"`       | `LABEL "x"`       | `label`         |
| `WITH x = value`  | `WITH x = value`  | `input.x`       |
| `AS result`       | `AS result`       | `commitAs`      |
| `MODE replace`    | `MODE replace`    | `commitMode`    |
| `WHEN condition`  | `WHEN condition`  | `when`          |
| `USES capability` | `USES capability` | `uses`          |

The only patch-specific verbs are structural:

```txt
PATCH
ADD
UPDATE
DELETE
MOVE
BEFORE
AFTER
```

That is the right boundary.

---

# Patch operation mapping

```eql
UPDATE STEP generate_brief
  WITH prompt = "Create a tighter executive brief."
```

Compiles to a patch operation that updates:

```json
{
  "steps[generate_brief].input.prompt": "Create a tighter executive brief."
}
```

But the model never sees that path form.

```eql
UPDATE STEP generate_brief
  AS brief MODE replace
```

Compiles to:

```json
{
  "commitAs": "brief",
  "commitMode": "replace"
}
```

```eql
ADD STEP send_email AFTER generate_brief USES @executioncontrolprotocol/email.send
  WITH subject = "Weekly brief"
  WITH body = REF brief.content
```

Compiles to a canonical step insert after `generate_brief`.

---

# Revised v1 options

```ts
export interface EqlFormatOptions {
  /**
   * Emit or require the ECP schema/version header.
   * Default: true for encode.
   * Decode accepts both, but no-header decode requires `to`.
   */
  header?: boolean;

  /**
   * Preserve manifest IDs exactly.
   * Default: true.
   */
  preserveIds?: boolean;

  /**
   * Quote strategy for scalar strings.
   * Default: "auto".
   */
  quote?: "auto" | "always";

  /**
   * Indentation spaces for nested blocks.
   * Default: 2.
   */
  indent?: number;
}
```

No `compact` in v1.

---

# Revised implementation phases

## Phase 1: Shared built-in capability interfaces

Add minimum interfaces to `@executioncontrolprotocol/types`:

```ts
EncodeCapabilityInput
EncodeCapabilityOutput
DecodeCapabilityInput
DecodeCapabilityOutput
GenerateCapabilityInput
GenerateCapabilityOutput
EvaluateCapabilityInput
EvaluateCapabilityOutput
CapabilityDiagnostic
```

Acceptance:

* `@executioncontrolprotocol/format-eql.encode` extends `EncodeCapabilityInput`.
* `@executioncontrolprotocol/format-eql.decode` extends `DecodeCapabilityInput`.
* Existing/future model providers can extend `GenerateCapabilityInput`.
* Existing/future eval providers can extend `EvaluateCapabilityInput`.

The current type package already centralizes core protocol types like schema names, workflow manifests, refs, state values, validation, lifecycle, and store types, so this is the right place to add the common built-in capability contracts.

## Phase 2: `format-eql` package scaffold

Implement:

```ts
formatEqlExtension
registerFormatEqlExtension()
@executioncontrolprotocol/format-eql.encode
@executioncontrolprotocol/format-eql.decode
```

No browser app integration.

## Phase 3: Workflow encode/decode

Support:

```txt
WORKFLOW
STEP
USES
LABEL
WITH
AS
MODE
WHEN
REF
STATE
```

Acceptance:

```eql
WORKFLOW test "Test"

STEP echo USES @executioncontrolprotocol/test.echo
  WITH value = "hi"
  AS echo
```

round-trips to a valid `@executioncontrolprotocol.workflow`.

## Phase 4: Header behavior

Support:

```ts
options: { header: false }
```

Acceptance:

* Encode omits `ECP @executioncontrolprotocol.workflow 1.0`.
* Decode succeeds without header when `to: "@executioncontrolprotocol.workflow"` is provided.
* Decode returns a diagnostic when both header and `to` are missing.

## Phase 5: Patch encode/decode

Support:

```txt
PATCH WORKFLOW
UPDATE WORKFLOW
UPDATE STEP
ADD STEP
DELETE STEP
MOVE STEP
BEFORE
AFTER
```

`PATCH WORKFLOW` opens the patch document and names the target workflow. `UPDATE WORKFLOW` and `UPDATE STEP` change metadata on the workflow or a step. `ADD STEP`, `DELETE STEP`, and `MOVE STEP` are structural step CRUD.

Inside `UPDATE WORKFLOW`, `ADD`, and `UPDATE STEP`, use normal field verbs:

```txt
USES
LABEL
WITH
AS
MODE
WHEN
```

Acceptance:

```eql
PATCH WORKFLOW weekly_brief

UPDATE STEP generate_brief
  WITH prompt = "Create a tighter brief."
  AS brief MODE replace
```

compiles to canonical `@executioncontrolprotocol.patch`.

## Phase 6: Flow control

Support:

```txt
PARALLEL
BRANCH
LOOP
UNTIL
MAX
END
```

Flow control should mirror the existing workflow node types: `parallel`, `branch`, and `loop`.

## Phase 7: Harness/eval usage docs and tests

Document intended usage:

```ts
const generated = await ecp.invoke("@executioncontrolprotocol/openai.generate", {
  prompt,
  system: "Return only ECP EQL. No markdown.",
});

const decoded = await ecp.decode(generated.text)
  .uses("@executioncontrolprotocol/format-eql")
  .to("@executioncontrolprotocol.workflow")
  .with({ header: false });
```

This keeps generation separate from decoding and lines up with the binding grammar where harnesses delegate to model capabilities, while encode/decode delegate to formatter capabilities.

---

# Updated patch examples

## Update a step input

```eql
PATCH WORKFLOW brand_image_refinement

UPDATE STEP create_image
  WITH prompt = REF creativeInputs.generationPrompt
  WITH controls = REF creativeInputs.generationControls
```

## Update a capability

```eql
PATCH WORKFLOW weekly_brief

UPDATE STEP generate_brief
  USES @executioncontrolprotocol/anthropic.generate
```

## Add a step

```eql
PATCH WORKFLOW weekly_brief

ADD STEP summarize_risks AFTER collect_signals USES @executioncontrolprotocol/openai.generate
  LABEL "Summarize Risks"
  WITH prompt = "Summarize the top risks."
  WITH context = REF signals.results
  AS riskSummary
```

## Delete a step

```eql
PATCH WORKFLOW weekly_brief

DELETE STEP old_notification
```

## Move a step

```eql
PATCH WORKFLOW weekly_brief

MOVE STEP send_brief AFTER generate_brief
```

## Supported patch operations

```text
PATCH WORKFLOW weekly_brief

UPDATE STEP generate_brief
  SET LABEL = "Generate Executive Brief"
  SET WITH.prompt = "Create a tighter executive brief."
  SET WITH.context = REF signals.results
  SET AS = brief
  SET MODE = replace

ADD STEP send_email AFTER generate_brief USES @executioncontrolprotocol/email.send
  LABEL "Send Email"
  WITH subject = "Weekly brief"
  WITH body = REF brief.content

DELETE STEP old_notify

MOVE STEP send_email AFTER generate_brief
```

## Environment descriptor EQL

This is optional but valuable for model prompting.

Input:

`EnvironmentDescriptor`

EQL:

```eql
ECP @executioncontrolprotocol.environment.describe 1.0

CAPABILITY @executioncontrolprotocol/memory.search
  LABEL "Search Memory"
  WITH query:string!
  WITH since:string
  OUT results:array

CAPABILITY @executioncontrolprotocol/openai.generate
  LABEL "Generate Text"
  WITH prompt:string!
  WITH context:any
  OUT content:string

POLICY @executioncontrolprotocol/budget
  LABEL "Budget Guardrails"
```

## Prompt template for an EQL-based harness

```text
Return only a SQL-like language using the definition below. No markdown, no JSON, no formatting, no additional text.

Use these verbs:
WORKFLOW, STEP, USES, LABEL, WITH, REF, STATE, AS, MODE, WHEN, LOOP, UNTIL, MAX, END.

Rules:
- Use STEP <id> USES <capability>.
- Use WITH <name> = <value> for inputs.
- Use REF <path> to read committed workflow state.
- Use STATE <path> only when a capability needs a mutable state handle.
- Use AS <key> to commit step output.
- Use MODE only with: create, replace, merge, append, version.
- Do not invent capabilities.
- Do not include schema headers.

Available capabilities:
<descriptor encoded as compact EQL>

User request:
<request>
```

# Full Example

```eql
WORKFLOW brand_image_refinement "Brand image refinement"

STEP load_brand_standards USES @executioncontrolprotocol/memory.search
  LABEL "Load Brand Standards"
  WITH query = "brand standards, visual identity, approved campaign examples"
  AS brandStandards

STEP initialize_inputs USES @executioncontrolprotocol/creative.initializeInputs
  LABEL "Initialize Creative Inputs"
  WITH target = STATE creativeInputs
  WITH value = {
    generationPrompt: "Create a premium campaign hero image.",
    generationControls: {
      aspectRatio: "16:9",
      style: "premium lifestyle photography"
    }
  }

LOOP create_validate_fix UNTIL brandReview.approved == true MAX 3
  STEP create_image USES @executioncontrolprotocol/firefly.generateImage
    LABEL "Create Image"
    WITH prompt = REF creativeInputs.generationPrompt
    WITH controls = REF creativeInputs.generationControls
    WITH brandContext = REF brandStandards.results
    AS image MODE replace

  STEP validate_image USES @executioncontrolprotocol/openai.evaluate
    LABEL "Validate Image"
    WITH artifact = REF image
    WITH criteria = REF brandStandards.results
    WITH goal = "Evaluate whether the image follows brand standards."
    AS brandReview MODE replace

  STEP fix_inputs USES @executioncontrolprotocol/creative.fixInputs
    LABEL "Fix Creative Inputs"
    WHEN brandReview.approved == false
    WITH target = STATE creativeInputs
    WITH currentInputs = REF creativeInputs
    WITH review = REF brandReview
    WITH image = REF image
    WITH brandStandards = REF brandStandards.results
    AS fix MODE replace
END
```

---

# Updated acceptance criteria

`@executioncontrolprotocol/format-eql` v1 is complete when:

1. It exposes `@executioncontrolprotocol/format-eql.encode`.
2. It exposes `@executioncontrolprotocol/format-eql.decode`.
3. Both capabilities use the standard ECP encode/decode minimum interfaces.
4. It supports `header: false`.
5. It round-trips `@executioncontrolprotocol.workflow`.
6. It round-trips `@executioncontrolprotocol.patch`.
7. Patch syntax uses `WITH x = value`, not `SET WITH.x`.
8. It supports `REF` and `STATE`.
9. It preserves step order.
10. It emits line-oriented diagnostics.
11. It does not implement compact descriptor encoding in v1.
12. It does not require browser demo changes.
13. It is usable by harnesses and evals through standard encode/decode access.

The updated design principle:

> **EQL is Fluent-shaped text. It should use the same verbs users already see in the Fluent API and the same fields the runtime already understands.**

## Implementation status

`@executioncontrolprotocol/format-eql` is implemented under `packages/extensions/format-eql/` (encode/decode, unit tests, README). v1 covers linear workflows, patch documents, `@executioncontrolprotocol.environment` manifests, and `@executioncontrolprotocol.environment.describe` descriptors; flow control (`PARALLEL`, `BRANCH`, `LOOP`) and `@executioncontrolprotocol.environment.search` are deferred. Harness and eval wiring use a separate plan—call `registerFormatEqlExtension()` in the host environment before `ecp.encode` / `ecp.decode`.
