import { environment, harness, runtime, registerCoreFormats, registerTestExtension } from "@executioncontrolprotocol/core"
import {
  registerBrowserCodingHarnesses,
  BROWSER_CODING_HARNESS_ID,
  HARNESS_CODING_BINDING,
} from "../harness-coding-bindings.js"
import { registerNodeRuntime, NODE_RUNTIME_ID } from "@executioncontrolprotocol/node"
import { registerOllamaExtension } from "@executioncontrolprotocol/extension-ollama"
import { registerAnthropicExtension } from "@executioncontrolprotocol/anthropic"
import { registerFormatToonExtension } from "@executioncontrolprotocol/format-toon"
import type { EvalProviderProfile } from "../profiles/eval-provider.js"
import { setActiveEvalProvider } from "../profiles/eval-provider-context.js"
import { matrixExtensionBindings, providerExtensionBinding } from "./shared-eval-extensions.js"

async function registerNodeCodingMatrixEval(provider: EvalProviderProfile): Promise<void> {
  await registerCoreFormats()
  registerBrowserCodingHarnesses()
  await registerNodeRuntime()
  if (provider.providerId === "@executioncontrolprotocol/ollama") {
    await registerOllamaExtension()
  }
  if (provider.providerId === "@executioncontrolprotocol/anthropic") {
    await registerAnthropicExtension()
  }
  await registerFormatToonExtension()
  await registerTestExtension()
}

/**
 * Matrix harness eval environment for Node providers with Browser Coding harness.
 * @category Evals
 */
export async function createHarnessNodeCodingMatrixEnvironment(provider: EvalProviderProfile) {
  if (provider.runtime !== "node") {
    throw new Error(
      `createHarnessNodeCodingMatrixEnvironment expects runtime "node", got ${provider.runtime}`
    )
  }
  setActiveEvalProvider(provider)
  await registerNodeCodingMatrixEval(provider)
  return environment(
    `harness-${provider.id}-coding-matrix-eval`,
    `Harness ${provider.id} Coding Matrix Eval`
  )
    .withRuntime(runtime(NODE_RUNTIME_ID))
    .withExtensions([providerExtensionBinding(provider), ...matrixExtensionBindings()])
    .withHarnesses([
      harness(BROWSER_CODING_HARNESS_ID)
        .uses(provider.generateCapability)
        .with({ ...HARNESS_CODING_BINDING }),
    ])
}
