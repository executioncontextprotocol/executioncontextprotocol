import { describe, expect, it } from "vitest"
import {
  canonicalizeIntentTopic,
  correctClassifiedIntent,
  inferIntentFromMessageHeuristic,
} from "../../src/harness/authoring/classified-intent.js"
import { coerceIntentEqlRawOutput } from "../../src/harness/authoring/normalize-intent-eql-output.js"
import { ECP_INTENT_SCHEMA } from "@executioncontrolprotocol/types"

const intentDoc = (intent: string, topic?: string) => ({
  schema: ECP_INTENT_SCHEMA,
  intent,
  ...(topic ? { topic } : {}),
})

describe("inferIntentFromMessageHeuristic", () => {
  it("maps definitional and greeting messages", () => {
    expect(inferIntentFromMessageHeuristic("What is ECP?")).toBe("faq")
    expect(inferIntentFromMessageHeuristic("Hello there!")).toBe("general")
    expect(inferIntentFromMessageHeuristic("What is the run status?")).toBe("general")
  })

  it("maps workflow operations", () => {
    expect(
      inferIntentFromMessageHeuristic("The workflow failed on echo, help me fix it.")
    ).toBe("workflow-patch")
    expect(inferIntentFromMessageHeuristic("Remove all steps and start fresh.")).toBe(
      "workflow-patch"
    )
    expect(inferIntentFromMessageHeuristic("I need a new workflow with echo.")).toBe(
      "workflow-create"
    )
  })
})

describe("coerceIntentEqlRawOutput", () => {
  it("rewrites invalid intent tokens using message heuristics", () => {
    expect(
      coerceIntentEqlRawOutput(
        'INTIntent patching SUMMARY "User asks how to patch"',
        "How does workflow patching work?"
      )
    ).toBe('INTENT faq SUMMARY "User asks how to patch"')
    expect(
      coerceIntentEqlRawOutput(
        'INTIntent run-status SUMMARY "Workflow status"',
        "What is the run status?"
      )
    ).toBe('INTENT general SUMMARY "Workflow status"')
  })
})

describe("correctClassifiedIntent", () => {
  it("corrects workflow-create over-routing on greetings", () => {
    const corrected = correctClassifiedIntent(
      "Hello there!",
      intentDoc("workflow-create") as never
    )
    expect(corrected.intent).toBe("general")
    expect(corrected.topic).toBe("greeting")
  })

  it("canonicalizes joke topic to off-topic", () => {
    const corrected = correctClassifiedIntent(
      "Tell me a joke.",
      intentDoc("general", "joke") as never
    )
    expect(corrected.topic).toBe("off-topic")
  })

  it("canonicalizes faq patching topic", () => {
    const corrected = correctClassifiedIntent(
      "How does workflow patching work?",
      intentDoc("faq", "how-does or what-is") as never
    )
    expect(corrected.topic).toBe("patching")
  })
})

describe("canonicalizeIntentTopic", () => {
  it("prefers off-topic for jokes", () => {
    expect(canonicalizeIntentTopic("Tell me a joke.", "general", "joke")).toBe("off-topic")
  })
})
