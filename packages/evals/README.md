# @executioncontrolprotocol/evals

Private workspace package for the **harness eval framework**: case schema, runners, assertions, provider profiles, and fixture loaders. Product eval corpora and matrix drivers live in harness packages (`packages/harnesses/*/fixtures/`, `packages/harnesses/*/test/eval/`).

Eval configuration is **baked into source** (model id, base URL, harness bindings)—not driven by `OLLAMA_MODEL` / `OLLAMA_BASE_URL` environment variables.

## Pinned profile (default)

| Field | Value |
| ----- | ----- |
| Profile id | `ollama-gemma-1b` |
| Provider | `@executioncontrolprotocol/ollama` |
| Base URL | `http://localhost:11434` |
| Model | `gemma3:1b` |

Defined in [`src/profiles/ollama-gemma.ts`](src/profiles/ollama-gemma.ts) as `OLLAMA_GEMMA_1B_EVAL`.

## Chrome Nano profile (browser matrix)

| Field | Value |
| ----- | ----- |
| Profile id | `chrome-nano` |
| Provider | `@executioncontrolprotocol/chrome-ai` |
| Generate capability | `@executioncontrolprotocol/chrome-ai.generate` |
| Runtime | `@executioncontrolprotocol/browser` (Vitest browser project) |

Defined in [`src/profiles/chrome-nano.ts`](src/profiles/chrome-nano.ts) as `CHROME_NANO_EVAL`.

**Same harness, harness-owned fixtures, same assertions** as Ollama matrix — only the provider binding and runtime differ. Browser matrix tests: `packages/harnesses/browser-nano/test/eval/browser/`.

```sh
npm run eval:matrix:chrome
```

Requires Google Chrome with the on-device Gemini Nano model available (`LanguageModel` API). Tests **skip** when Nano is not ready (same contract as Ollama skip).

LLM judge assertions use the active provider's `.evaluate` capability when the profile is judge-enabled (Ollama Gemma/Qwen and Anthropic Sonnet). Other providers skip judge automatically.

## Harness vs provider

| Layer | Package / id | Swappable? |
| ----- | ------------ | ---------- |
| Harness (prompts, repair, decode) | `@executioncontrolprotocol/harness-browser-nano` | **No** — reusable for all providers |
| Provider | `@executioncontrolprotocol/ollama.generate`, `@executioncontrolprotocol/chrome-ai.generate`, … | **Yes** — environment `.uses()` only |
| Eval cases | `packages/harnesses/*/fixtures/eval-cases/` | Per harness (duplicated where needed) |

To add a provider: implement `@executioncontrolprotocol/model.generate`, add an `EvalProviderProfile`, wire a harness-local matrix environment factory. Do not change harness task handlers.

## Run evals

```sh
ollama pull gemma3:1b
npm run eval:matrix
```

Coding harness with Anthropic (skips when `ANTHROPIC_API_KEY` is unset):

```sh
pnpm run test:eval:matrix:coding:anthropic
```

Quick smoke (chat orchestrator + fixture count):

```sh
npm run test:eval:smoke
```

`npm run eval` and `npm run test:eval` both run the full matrix (81 cases, including **chat** multi-shot orchestrator).

From the repo root. Tests **skip** when Ollama is down or the model is not pulled; when Ollama is up, failures are real regressions.

Run one eval file:

```sh
npx vitest run --project eval packages/harnesses/browser-nano/test/eval/matrix-chat.eval.test.ts
```

## Eval sets

| Eval set | Environment factory | Harness | Encoding |
| -------- | ------------------- | ------- | -------- |
| **Matrix Nano (81 cases)** | `createNanoOllamaMatrixEnvironment()` in browser-nano test helpers | `@executioncontrolprotocol/harness-browser-nano` | EQL output (headerless) + EQL/TOON descriptor |
| **Matrix Coding (63 cases)** | `createCodingOllamaMatrixEnvironment()` in browser-coding test helpers | `@executioncontrolprotocol/harness-browser-coding` | TypeScript (Fluent workflows + typed intent/reply) |
| **Matrix Chrome Nano** | `createNanoBrowserMatrixEnvironment(CHROME_NANO_EVAL)` | same harness | same encoding as Nano matrix |

### Extension alignment (matrix)

Matrix evals bind **formatters and test workflow stubs** only (no memory/storage/telemetry):

| Extension | Why |
| --------- | --- |
| `@executioncontrolprotocol/ollama` | Model provider (`gemma3:1b`) and `@executioncontrolprotocol/ollama.evaluate` judge |
| `@executioncontrolprotocol/format-toon` | Legacy descriptor encoding (optional; matrix uses plain-text + EQL grammar in prompts) |
| `@executioncontrolprotocol/format-eql` | Harness model output (workflow, patch, intent, reply) — headerless |
| `@executioncontrolprotocol/format-json` | Run context encoding (core formatter, explicit binding) |
| `@executioncontrolprotocol/chrome-ai` / `@executioncontrolprotocol/ollama` | Generate capabilities used in harness workflow prompts and fixtures |

Legacy smoke environments use `@executioncontrolprotocol/format-toon` + `@executioncontrolprotocol/test` only.

Harness config lives in [`src/harness-eval-config.ts`](src/harness-eval-config.ts). Intent evals set `includeEnvironmentDescriptor: true` so the model sees available capabilities before classifying.

Tests live under `packages/harnesses/browser-nano/test/eval/` (Node + Ollama) and `packages/harnesses/browser-nano/test/eval/browser/` (Chrome Nano). Coding matrix: `packages/harnesses/browser-coding/test/eval/`.

## Traceability when a model fails

Harness results include a `trace` object when invoke succeeds. Eval tests enable full trace via `HARNESS_NANO_TRACE` (`includePrompt`, `includeRawOutput`, `includeValidation`).

### Eval debug logging (`ECP_EVAL_DEBUG`)

Set **`ECP_EVAL_DEBUG`** when running eval tests to print structured troubleshooting output for each case (console warnings + optional NDJSON file).

| Value | Behavior |
| ----- | -------- |
| `1` / `true` / `failures` | Log **failed** invokes and assertion mismatches only |
| `all` / `verbose` | Log **every** case (context before invoke + full invoke report) |

Optional: **`ECP_EVAL_DEBUG_FILE`** — append one JSON object per line (e.g. `.cursor/eval-debug.ndjson`).

**Repair-loop timing:** set **`ECP_EVAL_DEBUG_TIMING=1`** to log per-attempt `generateMs` (Ollama API) vs `evaluateMs` (compile/validate) and per-case `invokeMs` / `judgeMs`. Use with [`matrix-coding-debug.eval.test.ts`](test/harness/matrix-coding-debug.eval.test.ts) for a focused failing-case subset.

Example:

```sh
# Windows PowerShell
$env:ECP_EVAL_DEBUG = "failures"
$env:ECP_EVAL_DEBUG_FILE = ".cursor/eval-debug.ndjson"
npm run build
npx vitest run --project eval packages/evals/test/harness/matrix-workflow-patch.eval.test.ts -t "wf-patch-03"
```

Each failure block includes:

- **input** — resolved case input (manifest summarized when present)
- **expected assertions** — human-readable `describeAssertionExpectation` per assertion
- **prompt** / **rawModelOutput** — from `trace` (requires `HARNESS_NANO_TRACE`, already on for matrix)
- **artifact** — decoded JSON (truncated)
- **assertion mismatch** — expected vs `extractAssertionActual` snapshot

All matrix / `runEvalCase` tests pick this up automatically; no per-test changes required.

| Failure stage | What you see |
| ------------- | ------------ |
| **Invoke failed** (`success: false`) | `assertHarnessInvokeSuccess` prints `formatInvokeFailure(result)` — diagnostics codes/messages. Decode errors from the harness include `rawModelOutput:` in the diagnostic text. |
| **Wrong artifact** (invoke succeeded) | Use `expect(..., harnessTraceHint(harnessOutput))` or `expectHarnessIntent(result, intent)` — Vitest shows prompt, raw model text, validation errors, provider, and model. |
| **Manual inspection** | `formatHarnessTrace(harnessOutput)` in [`src/fixtures/harness-trace-format.ts`](src/fixtures/harness-trace-format.ts) (re-exported from [`test/harness/assert-harness-result.ts`](test/harness/assert-harness-result.ts)) |

Example on assertion mismatch:

```ts
import { expectHarnessIntent, harnessTraceHint } from "./assert-harness-result.js"

const output = expectHarnessIntent(result, ECP_INTENT_VALUES.WORKFLOW_CREATE)
// or
expect(got.intent, harnessTraceHint(harnessOutput)).toBe(ECP_INTENT_VALUES.WORKFLOW_PATCH)
```

Typical failure stages for intent evals:

1. **Model** — malformed EQL in `trace.rawOutput` (fences, prose, invented capabilities). Repair retries strip fences and pass decode errors back to the model.
2. **Decode** — `@executioncontrolprotocol/format-eql` rejects output; error message includes field paths and `rawModelOutput`.
3. **Validation** — decoded document missing required schema fields or invalid enums (`trace.validation`).

### Repair loop (model learns from failures)

Core collectors (`collectDecodeFeedback`, `collectPatchFeedback`, `collectValidationFeedback`) produce `HarnessOperationFeedback` with paths and codes. Eval harnesses format that into repair prompts via `formatFeedbackForModel` from `@executioncontrolprotocol/core`.

Harness config supports `repair` (enabled in eval via `HARNESS_NANO_REPAIR`):

| Setting | Eval default | Effect |
| ------- | ------------ | ------ |
| `enabled` | `true` | Retry after decode, patch, or validation failures |
| `maxAttempts` | `2` | Up to 3 total model calls (initial + 2 repairs) |
| `includeValidationErrors` | `true` | Next prompt includes `path: message [CODE]` details |

On retry, the model sees lines like:

```text
Previous attempt failed. Fix these issues and return corrected output only:
schema: Required [INVALID_TYPE]; patches: Required [INVALID_TYPE]
Patch document must include: schema @executioncontrolprotocol.patch, version, targetSchema @executioncontrolprotocol.workflow, patches array...
```

Inspect the repair prompt in `trace.prompt` on the final successful or failed attempt.

Run a single eval with verbose Vitest output:

```sh
npx vitest run --project eval packages/evals/test/harness/intent-classification.eval.test.ts --reporter=verbose
```

## Fixture-driven matrix (JSON)

Cases live in [`fixtures/cases/*.cases.json`](fixtures/cases/) as `{ "cases": [ ... ] }` arrays. Vitest matrix tests load them with `loadEvalCases()` and `runEvalCase()`—no new `it()` per row.

| File | Suite | Count |
| ---- | ----- | ----- |
| `workflow-create.cases.json` | `workflow-create` | 12 |
| `workflow-patch.cases.json` | `workflow-patch` | 12 |
| `intent.cases.json` | `intent` | 17 |
| `assistant.cases.json` | `assistant` | 22 |
| `flow.cases.json` | `flow` | 9 |

**Full case-by-case report:** [docs/harness-eval-matrix-report.md](../../docs/harness-eval-matrix-report.md).

Supporting JSON: [`fixtures/workflows/`](fixtures/workflows/), [`fixtures/runs/`](fixtures/runs/).

Assertions per row:

- **Deterministic** — schema, validation, intent, step `uses`, patch outcomes, descriptor extension order, `answerRedirectsToScope`, `answerMaxLength`, `rawNotContains`.
- **Judge** (optional) — `@executioncontrolprotocol/ollama.evaluate` with `goal` / `rubric`; set `requireApproved: true` when the model must pass review. Judge errors fail closed (never treated as pass).

Harness **system prompts** live in `packages/harnesses/*/fixtures/harness-prompts/` (loaded via harness-local loaders + `buildSystemPromptFromFixture` from `@executioncontrolprotocol/core`). Eval case JSON holds inputs and assertions only.

**Flow cases:** step 0 failures are intent harness invoke failures, not run/fixture load failures (see [harness-eval.md](../../docs/harness-eval.md)).

Regenerate baseline case files from the generator script:

```sh
node packages/evals/scripts/generate-eval-cases.mjs
```

## Creating a new eval case (manual)

### 1. Add a JSON row

Edit the suite file under `fixtures/cases/` (see table above). Use `model: "default"` for the pinned Gemma profile.

### 2. Add a fixture (optional)

```text
packages/evals/fixtures/my-workflow.json
```

Use for patch evals or golden baselines.

### 3. Add a test file

Create `packages/evals/test/harness/my-scenario.eval.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { harnessCapabilityId } from "@executioncontrolprotocol/types"
import {
  OLLAMA_GEMMA_1B_EVAL,
  createHarnessOllamaWorkflowEnvironment,
  ollamaEvalReady,
} from "@executioncontrolprotocol/evals"
import { assertHarnessInvokeSuccess, harnessResult } from "./assert-harness-result.js"

const readiness = await ollamaEvalReady()

describe.skipIf(!readiness.ready)(
  `my scenario (${readiness.profileId} ${readiness.model})`,
  () => {
    it("does something assertable", async () => {
        const env = await createHarnessOllamaWorkflowEnvironment()
        const ecp = await env.init()

        const result = await ecp
          .invoke(EVALS_WORKFLOW_AUTHORING_CAPABILITY)
          .with({
            request: "Natural language request for the model.",
            model: OLLAMA_GEMMA_1B_EVAL.model,
          })
          .process()

        assertHarnessInvokeSuccess(result)
        const out = harnessResult(result)
        expect(out.artifact.schema).toBe("@executioncontrolprotocol.workflow")
        await ecp.terminate()
    })
  }
)
```

Eval tests use a **120s** default timeout on the Vitest `eval` project (`testTimeout` in [`vitest.config.mts`](../../vitest.config.mts)).

Reuse [`assert-harness-result.ts`](test/harness/assert-harness-result.ts) for `assertHarnessInvokeSuccess`, `harnessTraceHint`, and `expectHarnessIntent`.

### 4. Assert narrowly

Prefer checks the model can reliably satisfy:

- `result.success`, `artifact.schema`, `validation.valid`
- `trace.decodeSucceeded`, `trace.outputFormat`
- Concrete workflow fields (step count, label, input value) for patch cases

### 5. Fast offline tests stay in `@executioncontrolprotocol/core`

Deterministic harness behavior (`@executioncontrolprotocol/test.generate`, mocks) belongs in `packages/core/test/` and runs in `npm run test:unit`. Reserve `@executioncontrolprotocol/evals` for real model scrutiny.

## Changing the pinned model

Edit [`src/profiles/ollama-gemma.ts`](src/profiles/ollama-gemma.ts) and update environment factories if bindings change. Re-run `ollama pull <new-tag>` locally and align CI model pull in [`.github/workflows/evals.yml`](../../.github/workflows/evals.yml).

## More documentation

See [Harness evaluation](../../docs/harness-eval.md) in `docs/`.
