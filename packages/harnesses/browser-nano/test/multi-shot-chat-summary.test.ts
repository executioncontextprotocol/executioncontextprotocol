import { describe, expect, it, beforeAll } from "vitest"
import {
  catalogExtension,
  capabilityFor,
  defineExtension,
  environment,
  extension,
  harness,
  registerCoreFormats,
} from "@executioncontrolprotocol/core"
import {
  BROWSER_NANO_HARNESS_CAPABILITY,
  registerBrowserNanoHarnesses,
  resetBrowserNanoHarnessRegistrationForTests,
  chatResultSuggestedAction,
  chatResultWorkflow,
  WORKFLOW_CHANGE_SUMMARY_SHOT_TASK,
} from "@executioncontrolprotocol/harnesses-browser-nano"
import { registerFormatEqlExtension } from "@executioncontrolprotocol/format-eql"
import { registerNodeRuntime, runtime, NODE_RUNTIME_ID } from "@executioncontrolprotocol/node"
import {
  ECP_HARNESS_REPLY_SCHEMA,
  modelGenerateInputSchema,
  modelGenerateOutputSchema,
  type HarnessInvokeResult,
} from "@executioncontrolprotocol/types"

const CHROME_GEN_EQL = `WORKFLOW demo "Demo"
STEP poem USES @executioncontrolprotocol/chrome-ai.generate
  LABEL "Generate Poem"
  WITH prompt = "Write a short poem about the ocean."
  AS poem`

const COMPOSITE_PATCH_EQL = `PATCH WORKFLOW probe-prefix
ADD STEP composite USES @executioncontrolprotocol/chrome-ai.generate AFTER manifest
  LABEL "Create Composite"
  WITH prompt = "Composite Headline and Logo"
  AS composite
`

/** Node-safe stub so workflows can USE chrome-ai.generate under the Node runtime. */
const chromeAiStubExtension = defineExtension("@executioncontrolprotocol", "chrome-ai")
  .withConfig({})
  .withCapabilities([
    capabilityFor("@executioncontrolprotocol/chrome-ai", "generate")
      .withInput(modelGenerateInputSchema)
      .withOutput(modelGenerateOutputSchema)
      .withHandler(async () => ({ text: "stub generate" })),
  ])
  .build()

const scriptedGenExtension = defineExtension("@executioncontrolprotocol", "scripted-chat-gen")
  .withConfig({})
  .withCapabilities([
    capabilityFor("@executioncontrolprotocol/scripted-chat-gen", "generate")
      .withInput(modelGenerateInputSchema)
      .withOutput(modelGenerateOutputSchema)
      .withHandler(async (input) => {
        const prompt = typeof input.prompt === "string" ? input.prompt : ""
        if (/Summarize the workflow changes/i.test(prompt)) {
          return {
            text: `REPLY
  ANSWER "I created a Chrome AI generate workflow. Want me to run it?"
  ACTION offer-run`,
          }
        }
        if (/Summarize the discovery prefix|run the probe/i.test(prompt)) {
          return {
            text: `REPLY
  ANSWER "I drafted a discovery prefix. Want me to run the probe?"
  ACTION offer-probe`,
          }
        }
        // Case-sensitive STEP/WORKFLOW so "Create a workflow..." still counts as intent.
        const looksLikeAuthoringPrompt =
          /\bEnvironment\b/.test(prompt) ||
          /\bExisting step\b/.test(prompt) ||
          /\bcapabilities loaded\b/i.test(prompt) ||
          /^STEP /m.test(prompt) ||
          /^WORKFLOW /m.test(prompt)
        const isIntentShot =
          /intent classification|Classify the user message into exactly one intent/i.test(
            prompt
          ) ||
          (/User message: /i.test(prompt) && !looksLikeAuthoringPrompt)
        if (isIntentShot) {
          if (/What is ECP/i.test(prompt)) {
            return {
              text: `INTENT faq
  TOPIC ecp
  SUMMARY "what is ecp"`,
            }
          }
          if (/Inspect what's in this PSD|Discover structure first/i.test(prompt)) {
            return {
              text: `INTENT workflow-probe
  TOPIC photoshop-layers
  SUMMARY "discover layers first"`,
            }
          }
          if (/Use the Headline and Logo/i.test(prompt)) {
            return {
              text: `INTENT workflow-clarify
  TOPIC layer-selection
  SUMMARY "select layers"`,
            }
          }
          return {
            text: `INTENT workflow-create
  TOPIC create
  SUMMARY "create generate workflow"`,
          }
        }
        if (
          /\bExisting step\b/.test(prompt) ||
          /\bpatch\b/i.test(prompt) ||
          /Use the Headline and Logo/i.test(prompt)
        ) {
          return { text: COMPOSITE_PATCH_EQL }
        }
        return { text: CHROME_GEN_EQL }
      }),
  ])
  .build()

describe("multi-shot chat change summary", () => {
  beforeAll(async () => {
    await registerCoreFormats()
    await registerFormatEqlExtension()
    await registerNodeRuntime()
    catalogExtension(chromeAiStubExtension)
    catalogExtension(scriptedGenExtension)
    resetBrowserNanoHarnessRegistrationForTests()
    registerBrowserNanoHarnesses()
  })

  it("returns reply with offer-run and sidecar workflow after create", async () => {
    const env = environment("multi-shot-chat-summary-test")
      .withRuntime(runtime(NODE_RUNTIME_ID))
      .withExtensions([
        extension("@executioncontrolprotocol/format-eql").with({}),
        extension("@executioncontrolprotocol/chrome-ai").with({}),
        extension("@executioncontrolprotocol/scripted-chat-gen").with({}),
      ])
      .withHarnesses([
        harness("@executioncontrolprotocol/harness-browser-nano")
          .uses("@executioncontrolprotocol/scripted-chat-gen.generate")
          .with({ repair: { maxAttempts: 1 } }),
      ])

    const ecp = await env.init()
    try {
      const result = await ecp
        .invoke(BROWSER_NANO_HARNESS_CAPABILITY)
        .with({
          task: "chat",
          message: "Create a workflow with Chrome AI generate.",
        })
        .process()

      expect(result.success).toBe(true)
      const output = result.result as HarnessInvokeResult
      expect(output.artifact).toMatchObject({
        schema: ECP_HARNESS_REPLY_SCHEMA,
        suggestedAction: "offer-run",
      })
      expect(chatResultSuggestedAction(output)).toBe("offer-run")
      expect(chatResultWorkflow(output)?.schema).toBe("@executioncontrolprotocol.workflow")
      expect(output.trace.shots?.length).toBe(3)
      expect(output.trace.shots?.[2]?.task).toBe(WORKFLOW_CHANGE_SUMMARY_SHOT_TASK)
    } finally {
      await ecp.terminate()
    }
  })

  it("keeps FAQ at two shots without offer-run", async () => {
    const env = environment("multi-shot-chat-faq-test")
      .withRuntime(runtime(NODE_RUNTIME_ID))
      .withExtensions([
        extension("@executioncontrolprotocol/format-eql").with({}),
        extension("@executioncontrolprotocol/chrome-ai").with({}),
        extension("@executioncontrolprotocol/scripted-chat-gen").with({}),
      ])
      .withHarnesses([
        harness("@executioncontrolprotocol/harness-browser-nano")
          .uses("@executioncontrolprotocol/scripted-chat-gen.generate")
          .with({}),
      ])

    const ecp = await env.init()
    try {
      const result = await ecp
        .invoke(BROWSER_NANO_HARNESS_CAPABILITY)
        .with({
          task: "chat",
          message: "What is ECP?",
        })
        .process()

      expect(result.success).toBe(true)
      const output = result.result as HarnessInvokeResult
      expect(output.trace.shots?.length).toBe(2)
      expect(chatResultSuggestedAction(output)).toBeUndefined()
      expect(chatResultWorkflow(output)).toBeUndefined()
      expect((output.artifact as { schema?: string }).schema).toBe(ECP_HARNESS_REPLY_SCHEMA)
    } finally {
      await ecp.terminate()
    }
  })

  it("routes workflow-probe to authoring with offer-probe", async () => {
    const env = environment("multi-shot-chat-probe-test")
      .withRuntime(runtime(NODE_RUNTIME_ID))
      .withExtensions([
        extension("@executioncontrolprotocol/format-eql").with({}),
        extension("@executioncontrolprotocol/chrome-ai").with({}),
        extension("@executioncontrolprotocol/scripted-chat-gen").with({}),
      ])
      .withHarnesses([
        harness("@executioncontrolprotocol/harness-browser-nano")
          .uses("@executioncontrolprotocol/scripted-chat-gen.generate")
          .with({ repair: { maxAttempts: 1 } }),
      ])

    const ecp = await env.init()
    try {
      const result = await ecp
        .invoke(BROWSER_NANO_HARNESS_CAPABILITY)
        .with({
          task: "chat",
          message: "Inspect what's in this PSD then we'll choose layers.",
        })
        .process()

      expect(result.success).toBe(true)
      const output = result.result as HarnessInvokeResult
      expect(output.trace.classifiedIntent?.intent).toBe("workflow-probe")
      expect(chatResultSuggestedAction(output)).toBe("offer-probe")
      expect(chatResultWorkflow(output)?.schema).toBe("@executioncontrolprotocol.workflow")
      expect(output.trace.shots?.some((s) => s.task === "workflow-authoring")).toBe(true)
    } finally {
      await ecp.terminate()
    }
  })

  it("clarify without probeContext falls back safely", async () => {
    const env = environment("multi-shot-chat-clarify-fallback-test")
      .withRuntime(runtime(NODE_RUNTIME_ID))
      .withExtensions([
        extension("@executioncontrolprotocol/format-eql").with({}),
        extension("@executioncontrolprotocol/chrome-ai").with({}),
        extension("@executioncontrolprotocol/scripted-chat-gen").with({}),
      ])
      .withHarnesses([
        harness("@executioncontrolprotocol/harness-browser-nano")
          .uses("@executioncontrolprotocol/scripted-chat-gen.generate")
          .with({}),
      ])

    const ecp = await env.init()
    try {
      const result = await ecp
        .invoke(BROWSER_NANO_HARNESS_CAPABILITY)
        .with({
          task: "chat",
          message: "Use the Headline and Logo layers.",
        })
        .process()

      expect(result.success).toBe(true)
      const output = result.result as HarnessInvokeResult
      expect(output.trace.classifiedIntent?.intent).toBe("workflow-clarify")
      expect(chatResultSuggestedAction(output)).toBeUndefined()
      expect(chatResultWorkflow(output)).toBeUndefined()
    } finally {
      await ecp.terminate()
    }
  })

  it("clarify with probeContext and named options completes with offer-run", async () => {
    const env = environment("multi-shot-chat-clarify-complete-test")
      .withRuntime(runtime(NODE_RUNTIME_ID))
      .withExtensions([
        extension("@executioncontrolprotocol/format-eql").with({}),
        extension("@executioncontrolprotocol/chrome-ai").with({}),
        extension("@executioncontrolprotocol/scripted-chat-gen").with({}),
      ])
      .withHarnesses([
        harness("@executioncontrolprotocol/harness-browser-nano")
          .uses("@executioncontrolprotocol/scripted-chat-gen.generate")
          .with({ repair: { maxAttempts: 1 } }),
      ])

    const baseline = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0",
      workflow: { id: "probe-prefix", label: "Probe prefix" },
      steps: [
        {
          id: "manifest",
          uses: "@executioncontrolprotocol/chrome-ai.generate",
          as: "manifest",
        },
      ],
    }

    const ecp = await env.init()
    try {
      const result = await ecp
        .invoke(BROWSER_NANO_HARNESS_CAPABILITY)
        .with({
          task: "chat",
          message: "Use the Headline and Logo layers.",
          manifest: baseline,
          probeContext: {
            probeId: "probe-1",
            domain: "photoshop-layers",
            summary: "PSD has Headline and Logo",
            options: [
              { id: "layer-headline", label: "Headline" },
              { id: "layer-logo", label: "Logo" },
            ],
          },
        })
        .process()

      expect(result.success).toBe(true)
      const output = result.result as HarnessInvokeResult
      expect(output.trace.classifiedIntent?.intent).toBe("workflow-clarify")
      expect(chatResultSuggestedAction(output)).toBe("offer-run")
      expect(chatResultWorkflow(output)?.schema).toBe("@executioncontrolprotocol.workflow")
    } finally {
      await ecp.terminate()
    }
  })
})
