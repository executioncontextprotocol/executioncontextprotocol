# AGENTS.md

## Agent skill

For monorepo contribution work, install:

```bash
npx skills add executioncontrolprotocol/executioncontrolprotocol --skill ecp-core -y
```

Consumer Fluent / CLI / secrets: `npx skills add https://executioncontrolprotocol.io` (docs skill `ecp`).

**No `file:` package links.** Never put `"file:..."` in `package.json` dependency fields. It breaks CI and consumer installs. For unpublished local packages in consumer repos (browser-demo, extensions), use `pnpm run link:ecp` after building the sibling core monorepo. Keep registry ranges in `package.json`.

## ECP Fluent API monorepo (`@executioncontrolprotocol/*`)

| Path | Purpose |
| ---- | ------- |
| `packages/types/` | Protocol types (`@executioncontrolprotocol/types`) — [README](packages/types/README.md) |
| `packages/core/` | Fluent API, environment, in-memory engine (`@executioncontrolprotocol/core`) — [README](packages/core/README.md) |
| `packages/runtimes/node/` | Node runtime host (`@executioncontrolprotocol/node`) — [README](packages/runtimes/node/README.md) |
| `packages/runtimes/browser/` | Browser runtime host (`@executioncontrolprotocol/browser`) — [README](packages/runtimes/browser/README.md) |
| `packages/runtimes/temporal/` | Temporal runtime adapter stub (`@executioncontrolprotocol/runtime-temporal`) |
| [Browser demo (standalone)](https://github.com/executioncontrolprotocol/browser-demo) | Reference browser demo app (UI only) |
| `packages/mcp/` | MCP adapter (`@executioncontrolprotocol/mcp`) |
| `packages/cli/` | `ecp` CLI (`@executioncontrolprotocol/cli`) |
| `packages/policies/` | Budget, approval, state-control (`@executioncontrolprotocol/policies`) |
| `packages/evals/` | Harness/provider eval tests (`@executioncontrolprotocol/evals`, private); pinned `gemma3:1b` @ `localhost:11434` — see [packages/evals/README.md](packages/evals/README.md) |
| `packages/harnesses/browser-nano/` | Browser Nano harness (`@executioncontrolprotocol/harnesses-browser-nano`) — small-model demo + eval matrix |
| `packages/harnesses/browser-coding/` | Browser Coding harness (`@executioncontrolprotocol/harnesses-browser-coding`) — TypeScript/Fluent surface; Qwen 4B eval matrix |
| `packages/extensions/*/` | Protocol/platform first-party extensions (formats, secrets, memory, model providers) |
| [Vendor extensions (standalone)](https://github.com/executioncontrolprotocol/extensions) | Vendor integrations — dogfoods the extension package boundary; [canonical package list](https://github.com/executioncontrolprotocol/extensions#packages) |
| `archive/legacy-v0.5/` | Archived v0.5 Oclif CLI and snippets |
| `ecp-overhaul.md` | Implementation spec (source of truth) |

### Package boundaries

**No `file:` package links.** Never put `"file:..."` in `package.json` dependency fields. Consumer repos link unpublished `@executioncontrolprotocol/*` via `pnpm run link:ecp` after building the sibling core monorepo. Gate: `pnpm run check:no-file-deps`.

**Core is runtime-agnostic.** The main `@executioncontrolprotocol/core` barrel has no Node or browser I/O. Host-specific code is on subpaths:

| Subpath | Host |
| ------- | ---- |
| `@executioncontrolprotocol/core/node` | Node convenience re-export (loaders + compile) |
| `@executioncontrolprotocol/core/compile` | Node esbuild compile (`compileWorkflowSource`, `compileHarnessArtifactSource`) |
| `@executioncontrolprotocol/core/loaders` | Node file I/O (CLI) |
| `@executioncontrolprotocol/core/browser` | Browser authoring + esbuild-wasm compile (same compile APIs; blob eval) |

**Compile stays on core subpaths, not on runtime hosts.** Harnesses must call compile without importing `@executioncontrolprotocol/node` or `@executioncontrolprotocol/browser`. Portability = stable compile API + Node vs browser entry (`core/compile` vs `core/browser`, or the `"browser"` condition on `./compile`). Hosts may re-export compile for app convenience; that does not move ownership.

**Hosts wrap core; extensions/harnesses never import hosts.** `@executioncontrolprotocol/node` and `@executioncontrolprotocol/browser` bind runtimes and host config extensions. Extension and harness packages depend on `@executioncontrolprotocol/types` + `@executioncontrolprotocol/core` only.

**Three layers (compile / runtime / app):**

| Layer | Owns | Does not own |
| ----- | ---- | ------------ |
| `core/compile` + `core/browser` | Compile APIs and host-specific impl | Runtimes, harnesses, which model |
| `@executioncontrolprotocol/browser` (runtime host) | Executor, registry, session/local config, `createEcp` | Harnesses; which provider/model |
| Browser demo app | Binds harnesses + providers; picks harness + model; UI | Host internals |

**Browser runtime is harness-independent.** No harness package dependency on `@executioncontrolprotocol/browser`. The app binds nano/coding (and Ollama, Chrome AI, etc.) in its environment factory.

**Browser runtime vs browser demo app:**

| `@executioncontrolprotocol/browser` (runtime) | [browser-demo](https://github.com/executioncontrolprotocol/browser-demo) (app) |
| ------------------------ | ------------------------- |
| Executor, registry, session config, `createEcp`, workflow shim | React/Vite UI, chat layout, panels, Mermaid viewer |
| Slim `createBrowserEnvironment` / `registerBrowserHost` | `createDemoAppEnvironment` — formats, providers, harnesses, registry-control allowlist |
| Panel encode helper (`BrowserAuthoringService`) | `provider-mode.ts` / `HarnessMode`, first-run modal, Ollama settings, localStorage |

Do not add demo UI types (e.g. `ProviderMode`) to `@executioncontrolprotocol/browser`; keep them in the demo app. Provider and harness are **independent switches** in app code (a single UI value may set both, e.g. Ollama → coding + ollama).

**Operational APIs live on `Ecp` after `init()`**, not on the `Environment` builder (`run`, `encode`, `decode`, `patch`, `validate`, `describe`, `search`, `invoke`, `terminate`).

**Fluent rendering is in core** — `ecp.encode(...).as("fluent")`; there is no `@executioncontrolprotocol/format-fluent` extension.

### Two-track CI

| Track | When | Consumer install |
| ----- | ---- | ---------------- |
| **development** | PRs and pushes to `development` | Checkout sibling repos at `development`, build core, `pnpm run link:ecp` |
| **main / Pages** | `main` branch, GitHub Pages deploy | Registry install only (`pnpm install` from published `@executioncontrolprotocol/*`) |

Consumer repos (browser-demo, extensions) use `scripts/ci-setup-ecp.mjs` to detect the track. This monorepo is always built from source; it does not link siblings.

### Commands

```sh
pnpm install
pnpm run build
pnpm run generate:schema   # writes packages/types/dist/schemas/*.json
pnpm run check    # build + generate:schema + lint + secrets:scan + test:coverage + test:integration + test:e2e
pnpm run secrets:scan  # secretlint on the working tree (also lint-staged on pre-commit)
pnpm run test:unit
pnpm run test:coverage  # unit project + V8 coverage + thresholds (vitest.config.mts)
pnpm run test:consumer-cli  # pack + install into fixtures/consumer-cli layout; ecp compile/validate/run
pnpm run test:eval:matrix  # full harness matrix (Ollama gemma3:1b + qwen coder; skips when unavailable)
```

Pre-commit (`.husky/pre-commit`) runs `pnpm install` when lockfiles change and stages `pnpm-lock.yaml`, then lint-staged, lint, and coverage.

**Coverage:** `pnpm run build` does not enforce coverage. The ship gate is `pnpm run test:coverage` (husky pre-commit + CI `unit`). Floors live in `vitest.config.mts` (`coverage.thresholds`); target remains **90%** — raise floors toward 90, never lower them to green CI. New behavior needs **positive**, **negative**, and **edge** tests (see `.cursor/rules/testing-coverage.mdc`). Never use `!` negation in Vitest `test.include` (zeros coverage under projects; vitest#10164).

**Secrets:** Never commit live API keys. Use `.env` (gitignored), OS keychain, or CI secrets. Pre-commit runs Secretlint on staged files; CI `secrets` job runs Secretlint + Gitleaks (full history). Local: `pnpm run secrets:scan`.

Harness eval profile is baked in `packages/evals/src/profiles/ollama-gemma.ts` (not `OLLAMA_MODEL` env).

### CLI

Oclif v4 (`@oclif/core`). Commands live in `packages/cli/src/commands/`; build with `pnpm run build` before linking or tests.

**Published consumers:** `npm install -g @executioncontrolprotocol/cli`

**Monorepo dev:** from `packages/cli/` after `pnpm run build`, run `pnpm link --global`.

```sh
ecp run examples/01-echo/workflow.ts --env examples/01-echo/environment.ts
ecp run examples/07-accepts-returns/workflow.ts --env examples/07-accepts-returns/environment.ts --input examples/07-accepts-returns/input.json
ecp validate examples/01-echo/workflow.ts --env examples/01-echo/environment.ts
ecp compile examples/01-echo/workflow.ts -o /tmp/workflow.json
ecp describe --env examples/01-echo/environment.ts
ecp search "echo" --env examples/01-echo/environment.ts
ecp invoke @executioncontrolprotocol/test.echo --env examples/01-echo/environment.ts --input input.json
ecp serve --env examples/01-echo/environment.ts
ecp test start examples/01-echo/workflow.ts --env examples/01-echo/environment.ts -o session.json
ecp test run --to echo --env examples/01-echo/environment.ts --session session.json
ecp test rerun echo --env examples/01-echo/environment.ts --session session.json
ecp encode workflow.json --format toon --env examples/01-echo/environment.ts -o workflow.toon
ecp decode workflow.toon --format toon --env examples/01-echo/environment.ts -o workflow.json
ecp encode workflow.json --format fluent --env examples/01-echo/environment.ts -o workflow.generated.ts
ecp run --help
```

`ecp invoke` and `ecp serve` (`POST /v1/invoke`) call any bound capability outside a workflow run. MCP does **not** yet expose an `ecp.invoke` tool — use the Fluent API, CLI, or HTTP instead.

**Test sessions** (`ecp.test` / `ecp test …`) persist workflow state for inclusive `runTo` and single-step `rerun` (clears downstream history and `.as` keys). Distinct from `@executioncontrolprotocol/core/testing` capability stubs. HTTP/MCP test-session APIs are not available yet.

### Operational instance (`env.init()`)

`await env.init()` returns an **`Ecp`** instance for all operational APIs: `run`, `encode`, `decode`, `patch`, `validate`, `describe`, `search`, `invoke`, and `test` (workflow test sessions). Lifecycle: `environment:configuring` → bind extensions → `environment:ready`. Call `ecp.terminate()` to emit `environment:terminate`.

### Environment encoding, decoding, and patch

Utility operations do not emit run/step lifecycle hooks.

- Results use **`@executioncontrolprotocol.encode.result`** / **`@executioncontrolprotocol.decode.result`** / **`@executioncontrolprotocol.patch.result`** with `success`, **`.result`**, `validation`, and `diagnostics` (not `.content` / `.document`).
- `ecp.encode(source).uses("@executioncontrolprotocol/format-toon").to("@executioncontrolprotocol.workflow").with({ headers: false }).process()`
- `ecp.decode(input).uses("@executioncontrolprotocol/format-toon").to("@executioncontrolprotocol.patch").process()` — decode input field is **`input`** in `EcpDecodeInput` payloads to extensions.
- `ecp.patch(manifest).with(patchDocOrShorthand).process()` — patch paths use **`steps[<stepId>].field`** (globally unique step IDs; `WorkflowBuilder.toManifest()` assigns unique IDs).
- Omit `.uses(...)` for canonical JSON passthrough.
- **Fluent authoring (core):** `workflow(...).toManifest()` / `compileWorkflowSource` (Fluent/TS → manifest); `renderWorkflowToFluent` / `workflow(...).toFluentSource()` / `ecp.encode(...).as("fluent")` (manifest → Fluent source). No `@executioncontrolprotocol/format-fluent` extension.
- **TOON (extension):** `@executioncontrolprotocol/format-toon` via `.uses("@executioncontrolprotocol/format-toon")`; `headers` / `compact` options; validates workflow, environment, `@executioncontrolprotocol.patch`.
- MCP tools: `ecp.encode`, `ecp.decode` on `createEcpMcpServer`

### Extension catalog and binding

Extension packages call `catalogExtension(def)` at module load. **Examples use string bindings:** `extension("@executioncontrolprotocol/format-toon").with({})` after `import "@executioncontrolprotocol/format-toon"` (catalog lookup). For the in-repo stub, `import "@executioncontrolprotocol/core/testing"` then `extension("@executioncontrolprotocol/test").with({})`.

`ensureBoundExtensionsRegistered()` runs automatically before `encode`, `decode`, `describe`, and `run` — no separate `await register*()` in environment modules when the package catalogs on import.

### Extension authoring (third-party parity)

Protocol/platform packages under `packages/extensions/` and vendor packages in
[extensions](https://github.com/executioncontrolprotocol/extensions)
follow the same rules as external extension authors. See [`.cursor/rules/extensions.mdc`](.cursor/rules/extensions.mdc).
Keep **npm package name** aligned with the **extension id**.

| Do | Don't |
| ---- | ----- |
| Depend on `@executioncontrolprotocol/types` + `@executioncontrolprotocol/core` (+ focused third-party libs) | Import `@executioncontrolprotocol/node`, `@executioncontrolprotocol/browser`, `@executioncontrolprotocol/cli`, or `@executioncontrolprotocol/mcp` from an extension package |
| `catalogExtension(def)` on package load; optional `register*Extension(registry?)` | Call `describe()` / `run()` or require a host runtime inside extension tests |
| Test with document **fixtures** and `environment()` from `@executioncontrolprotocol/core` for encode/decode | Pull in `nodeEnvironment()` to build discovery payloads |
| Use `resolveFile` / `writeMediaArtifact` for image/binary I/O | Reimplement fs/fetch/`ctx.artifacts` maps inside vendor packages |

Vendor integrations are **not** in this monorepo — install from npm or link the sibling [extensions](https://github.com/executioncontrolprotocol/extensions) checkout. **Do not** enumerate vendor packages in core docs; link to that repo’s README instead.

Local dev: `pnpm --filter @executioncontrolprotocol/cli start` (runs `bin/dev.js` after build).

### Fluent API quickstart

```ts
import { workflow, step, ref } from "@executioncontrolprotocol/core"
import "@executioncontrolprotocol/core/testing"

const manifest = workflow("My flow")
  .accepts({ type: "object", properties: { value: { type: "string" } }, required: ["value"] })
  .returns({ type: "object", properties: { echo: { type: "object" } } })
  .run([step("@executioncontrolprotocol/test.echo", "Echo").with({ value: ref("value") }).as("echo")])
  .toManifest()
// Manifest steps use the same verbs as the fluent API: `.as("echo")` → `as: "echo"`; optional `{ mode }` → `mode: "create" | ...`
// `.accepts` / `.returns` serialize as `workflow.accepts` / `workflow.returns` (JSON Schema).

const env = (await environment("dev")).withExtensions([extension("@executioncontrolprotocol/test").with({})])
const ecp = await env.init()
await ecp.run(manifest)
```

### Browser

Browser demo: [browser-demo](https://github.com/executioncontrolprotocol/browser-demo) (standalone repo; uses `@executioncontrolprotocol/*` from npm or `pnpm run link:ecp`).

**Browser demo chat:** FAQ and assistant replies must come from the bound model provider via the selected harness (`chat` task). Do not route user-facing chat through template capabilities (`@executioncontrolprotocol/browser.guideChat`) or other non-model stand-ins. Defaults: **Chrome AI** + nano harness (EQL); **Ollama** + coding harness (Fluent/TS). The app resolves provider and harness independently (`resolveDemoSession`) and may override the provider via `.uses(...)` at invoke.

**Mechanism vs policy:** `@executioncontrolprotocol/browser-registry` handles freeze, `globalThis.ecp`, and auto-bind. **`@executioncontrolprotocol/registry-control`** (bound as a policy) authorizes dynamic extension registration via `policy:pre` and `registryRequest` on the policy context.

```ts
import { environment, workflow, step, extension, policy } from "@executioncontrolprotocol/browser"

const env = await environment("demo") // slim host: runtime + registry/session (apps bind providers/harnesses)

const ecp = await env.init()
await globalThis.ecp.registerExtension(customerExtension)

await ecp.run(workflow)
```

**Lifecycle:** `init()` emits `environment:created`, `environment:configuring`, and `environment:ready`. `run()` emits `environment:beforeRun`. Registry freeze is configured with **`freezeOn`**: `"environment:ready"` | `"environment:beforeRun"` | `"manual"` (default in demo: `"environment:beforeRun"`).

**Tests:**

```sh
pnpm run test:browser:install   # once per machine
pnpm run test:browser           # Vitest browser project (Chromium); separate from test:unit
```

CI runs the `browser` job in `.github/workflows/ci-pipeline.yml` (not part of `pnpm run check`).

Build order: `tsc -b tsconfig.build.json` (types → core → … → cli).

### Harness authoring surface

Reusable harness helpers are exported from `@executioncontrolprotocol/core`: `defineHarness`, `runModelRepairLoop`, `buildSystemPrompt`, `summarizeEnvironmentDescriptor`, `formatStructuredRepairForModel`, `buildAssistantSafeReply`, `summarizeProbeContext`, `buildPhotoshopLayersProbeContext`, etc. Shared task input Zod schemas live in `@executioncontrolprotocol/types` (`HARNESS_TASK_IDS`, `harnessWorkflowAssistantInputSchema`, `probeContextSchema`, …).

| Harness | Package | Id | Model surface | Eval profile |
| ------- | ------- | -- | ------------- | ------------ |
| Browser Nano | `@executioncontrolprotocol/harnesses-browser-nano` | `@executioncontrolprotocol/harness-browser-nano` | EQL multi-shot **chat** orchestrator | `ollama-gemma-1b` (`gemma3:1b`) — demo + `pnpm run test:eval:matrix` |
| Browser Coding | `@executioncontrolprotocol/harnesses-browser-coding` | `@executioncontrolprotocol/harness-browser-coding` | TypeScript (Fluent + typed intent/reply) | `ollama-qwen-coder-1.5b` (`qwen2.5-coder:1.5b`) — `pnpm run test:eval:matrix:coding` only |

`compileHarnessArtifactSource` in `@executioncontrolprotocol/core/compile` evaluates intent/reply TS modules. Workflow create/patch use `compileWorkflowSource`. The **`workflow-assistant`** task is the unified assistant (ECP FAQ, identity, environment help, run Q&A). Optional `identity: true` on prompt fixtures prepends `ECP_ASSISTANT_IDENTITY_PRIMER`.

**Probe → clarify → complete:** Chat intents `workflow-probe` and `workflow-clarify` drive a reusable discovery loop. Probe authors a prefix and suggests `offer-probe`; the host runs `ecp.test(…).runTo(cursor)`, builds domain-agnostic `ProbeContext` (Photoshop layers are the first exemplar via `buildPhotoshopLayersProbeContext`), then clarify turns select options and patch the remaining steps (`offer-run`). New domains add an adapter + prompt flavor — not new intents.

### Harness eval integrity

- Do not delete, skip, or weaken **valid** failing matrix/smoke eval tests to green CI.
- Do not fail-open quality gates (`@executioncontrolprotocol/ollama.evaluate` judge, schema validation) on errors.
- Triage harness prompts vs model vs fixture before changing assertions. Harness prompts: `packages/harnesses/*/fixtures/harness-prompts/`; eval framework: `@executioncontrolprotocol/evals`; eval cases: `packages/harnesses/*/fixtures/eval-cases/`.
