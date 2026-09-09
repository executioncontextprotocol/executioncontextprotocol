# @executioncontrolprotocol/harnesses-browser-nano

**Browser Nano** harness — catalog id **`@executioncontrolprotocol/harness-browser-nano`**. Tuned for on-device and small (~1B) models: short EQL replies, compact context, repair loop, identity primer.

Used by the browser demo and harness-owned eval matrices (Ollama gemma3:1b, Chrome Nano). **Same harness binding** (`HARNESS_NANO_BINDING`); the browser demo defaults to Chrome AI and may override the model provider at invoke.

## Fixtures and evals

| Asset | Location |
| ----- | -------- |
| Prompt fixtures | `fixtures/harness-prompts/*.prompt.json` |
| Eval cases | `fixtures/eval-cases/*.cases.json` (116 cases incl. chat + flow) |
| Support fixtures | `fixtures/workflows/`, `fixtures/runs/` |
| Matrix tests | `test/eval/` (Ollama), `test/eval/browser/` (Chrome Nano) |

Run matrix from repo root: `pnpm run test:eval:matrix`

For stronger cloud models, add a separate harness package (e.g. `@executioncontrolprotocol/harnesses-browser-nano-standard`) with its own prompts and output shaping.

## Invoke

```ts
import { BROWSER_NANO_HARNESS_CAPABILITY, HARNESS_TASKS } from "@executioncontrolprotocol/harnesses-browser-nano"

await ecp.invoke(BROWSER_NANO_HARNESS_CAPABILITY).with({
  task: HARNESS_TASKS.CHAT,
  message: "Create an echo workflow",
})
```

Tasks (all model outputs are **EQL** via `@executioncontrolprotocol/format-eql`):

| Task | Role |
| ---- | ---- |
| **`chat`** | **Default** multi-shot orchestrator: unfiltered intent, then contextualized authoring or assistant (including probe → clarify → complete) |
| `workflow-authoring` | Create or patch `@executioncontrolprotocol.workflow` via EQL |
| `intent-classification` | Route user messages (`faq`, `general`, `workflow-create`, `workflow-patch`, `workflow-probe`, `workflow-clarify`) |
| `workflow-assistant` | Unified assistant: ECP FAQ, identity, environment/capability help, run-aware Q&A (`@executioncontrolprotocol.harness.reply`) |

**Probe loop:** `workflow-probe` authors a discovery prefix and returns `suggestedAction: offer-probe`. After the host runs a test-session `runTo` and supplies `probeContext`, `workflow-clarify` lists or applies option selections, then patches remaining steps and offers `offer-run`. Pass `probeContext` on the `chat` task input.

**1B model policy:** normalize garbled EQL, deterministic assistant/patch recovery, then repair loop (`HARNESS_NANO_REPAIR`). Eval matrix and browser demo share this binding.

Reusable harness authoring helpers live in **`@executioncontrolprotocol/core`**. This package adds product routing and workflow-specific capability hints.
