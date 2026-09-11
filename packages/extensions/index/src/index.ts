export { registerMemoryExtension, memoryExtension } from "@executioncontrolprotocol/extension-memory"
export { registerOpenaiExtension, openaiExtension } from "@executioncontrolprotocol/extension-openai"
export { registerOllamaExtension, ollamaExtension } from "@executioncontrolprotocol/extension-ollama"
export { registerStorageExtension, storageExtension } from "@executioncontrolprotocol/extension-storage"
export { registerTelemetryExtension, telemetryExtension } from "@executioncontrolprotocol/extension-telemetry"
export { registerFormatToonExtension, formatToonExtension } from "@executioncontrolprotocol/format-toon"
export { registerFormatEqlExtension, formatEqlExtension } from "@executioncontrolprotocol/format-eql"
export { registerFormatMermaidExtension, formatMermaidExtension } from "@executioncontrolprotocol/format-mermaid"
export {
  registerFormatReactflowExtension,
  formatReactflowExtension,
} from "@executioncontrolprotocol/format-reactflow"

import { registerMemoryExtension } from "@executioncontrolprotocol/extension-memory"
import { registerOpenaiExtension } from "@executioncontrolprotocol/extension-openai"
import { registerOllamaExtension } from "@executioncontrolprotocol/extension-ollama"
import { registerStorageExtension } from "@executioncontrolprotocol/extension-storage"
import { registerTelemetryExtension } from "@executioncontrolprotocol/extension-telemetry"
import { registerFormatToonExtension } from "@executioncontrolprotocol/format-toon"
import { registerFormatEqlExtension } from "@executioncontrolprotocol/format-eql"
import { registerFormatMermaidExtension } from "@executioncontrolprotocol/format-mermaid"
import { registerFormatReactflowExtension } from "@executioncontrolprotocol/format-reactflow"

/** Namespaced ids registered by {@link registerAllExtensions}. */
export const BUNDLED_EXTENSION_IDS = [
  "@executioncontrolprotocol/memory",
  "@executioncontrolprotocol/openai",
  "@executioncontrolprotocol/ollama",
  "@executioncontrolprotocol/storage",
  "@executioncontrolprotocol/telemetry",
  "@executioncontrolprotocol/format-toon",
  "@executioncontrolprotocol/format-eql",
  "@executioncontrolprotocol/format-mermaid",
  "@executioncontrolprotocol/format-reactflow",
] as const

/**
 * Register all bundled first-party protocol/platform extensions on the global registry.
 *
 * This bundle is host-agnostic and dependency-light: it includes memory, storage,
 * telemetry, local/remote model providers that do not pull heavy SDKs (openai, ollama),
 * and format extensions used by harness encode/decode (toon, eql, mermaid, reactflow).
 *
 * Vendor integrations (fal, slack, image-sharp, adobe) live in the
 * `extensions` monorepo — install and register them explicitly.
 *
 * Intentionally excluded from this bundle:
 * - `@executioncontrolprotocol/chrome-ai` — browser-only (Chrome on-device `LanguageModel` API).
 * - `@executioncontrolprotocol/anthropic` — requires the Anthropic provider configuration/credentials.
 * - Vendor packages (`fal`, `slack`, `image-sharp`, `adobe`) — published from the extensions repo.
 *
 * @category Extensions
 */
export async function registerAllExtensions(): Promise<void> {
  await registerMemoryExtension()
  await registerOpenaiExtension()
  await registerOllamaExtension()
  await registerStorageExtension()
  await registerTelemetryExtension()
  await registerFormatToonExtension()
  await registerFormatEqlExtension()
  await registerFormatMermaidExtension()
  await registerFormatReactflowExtension()
}
