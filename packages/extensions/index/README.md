# @executioncontrolprotocol/extensions

Optional convenience bundle that registers the **host-agnostic, dependency-light**
first-party protocol/platform extensions in one call.

```ts
import { registerAllExtensions } from "@executioncontrolprotocol/extensions"

await registerAllExtensions()
```

## What `registerAllExtensions()` registers

| Extension | Purpose |
| --------- | ------- |
| `@executioncontrolprotocol/memory` | Memory capabilities + lifecycle hooks |
| `@executioncontrolprotocol/storage` | Key/value storage capabilities |
| `@executioncontrolprotocol/telemetry` | Lifecycle telemetry hooks |
| `@executioncontrolprotocol/openai` | OpenAI model provider |
| `@executioncontrolprotocol/ollama` | Local Ollama model provider |
| `@executioncontrolprotocol/format-toon` | TOON encode/decode |
| `@executioncontrolprotocol/format-eql` | EQL encode/decode (harness output) |
| `@executioncontrolprotocol/format-mermaid` | Mermaid encode (workflow graph) |
| `@executioncontrolprotocol/format-reactflow` | React Flow JSON encode + run-progress hooks |

The exact set is exported as `BUNDLED_EXTENSION_IDS`.

## Intentionally excluded

| Extension | Why excluded |
| --------- | ------------ |
| `@executioncontrolprotocol/chrome-ai` | Browser-only (Chrome on-device `LanguageModel` API) |
| `@executioncontrolprotocol/anthropic` | Requires Anthropic provider configuration/credentials |

**Vendor extensions** are published from the sibling [extensions](https://github.com/executioncontrolprotocol/extensions) repo — see that repo’s [package list](https://github.com/executioncontrolprotocol/extensions#packages). Do not maintain a vendor inventory in this README.

```ts
import { registerFalExtension } from "@executioncontrolprotocol/fal"
await registerFalExtension()
```
