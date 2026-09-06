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
import { registerTestExtension } from "../../../core/src/testing/test-extension.js"
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
  ANSWER "I created an echo workflow. Want me to run it?"
  ACTION offer-run`,
          }
        }
        // Intent classification prompts are short and ask for INTENT output
        if (
          /INTENT workflow-create|Reply with SQL-like EQL only|intent classification|Classify/i.test(
            prompt
          ) ||
          (/User message: Create a workflow with echo/i.test(prompt) &&
            !/Environment|Existing step|capabilities loaded/i.test(prompt))
        ) {
          if (/What is ECP/i.test(prompt)) {
            return {
              text: `INTENT faq
  TOPIC ecp
  SUMMARY "what is ecp"`,
            }
          }
          return {
            text: `INTENT workflow-create
  TOPIC create
  SUMMARY "create echo workflow"`,
          }
        }
        if (/What is ECP/i.test(prompt) && !/Environment|Existing step/i.test(prompt)) {
          return {
            text: `INTENT faq
  TOPIC ecp
  SUMMARY "what is ecp"`,
          }
        }
        // Authoring / repair
        return {
          text: `WORKFLOW demo "Demo"
STEP echo USES @executioncontrolprotocol/test.echo
  WITH value = "hello"
  AS echo`,
        }
      }),
  ])
  .build()

describe("multi-shot chat change summary", () => {
  beforeAll(async () => {
    await registerCoreFormats()
    await registerFormatEqlExtension()
    await registerNodeRuntime()
    await registerTestExtension()
    catalogExtension(scriptedGenExtension)
    resetBrowserNanoHarnessRegistrationForTests()
    registerBrowserNanoHarnesses()
  })

  it("returns reply with offer-run and sidecar workflow after create", async () => {
    const env = environment("multi-shot-chat-summary-test")
      .withRuntime(runtime(NODE_RUNTIME_ID))
      .withExtensions([
        extension("@executioncontrolprotocol/format-eql").with({}),
        extension("@executioncontrolprotocol/test").with({}),
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
          message: "Create a workflow with echo.",
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
        extension("@executioncontrolprotocol/test").with({}),
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
})
