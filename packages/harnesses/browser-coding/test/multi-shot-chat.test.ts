import { describe, expect, it } from "vitest"
import { intentRoutesToAuthoring } from "@executioncontrolprotocol/harnesses-browser-nano"
import { ECP_INTENT_VALUES } from "@executioncontrolprotocol/types"
import { getHarnessCodingConfig, HARNESS_TASKS } from "../src/harness-coding-config.js"
import {
  chatResultAnswer,
  chatResultSuggestedAction,
  chatResultWorkflow,
} from "../src/multi-shot-chat.js"

describe("coding multi-shot chat helpers", () => {
  it("exposes chat task config", () => {
    const cfg = getHarnessCodingConfig(HARNESS_TASKS.CHAT)
    expect(cfg.repair).toBeDefined()
    expect(cfg.trace).toBeDefined()
  })

  it("routes create/patch/probe intents to authoring", () => {
    expect(intentRoutesToAuthoring(ECP_INTENT_VALUES.WORKFLOW_CREATE)).toBe(true)
    expect(intentRoutesToAuthoring(ECP_INTENT_VALUES.WORKFLOW_PATCH)).toBe(true)
    expect(intentRoutesToAuthoring(ECP_INTENT_VALUES.WORKFLOW_PROBE)).toBe(true)
    expect(intentRoutesToAuthoring(ECP_INTENT_VALUES.WORKFLOW_CLARIFY)).toBe(false)
    expect(intentRoutesToAuthoring(ECP_INTENT_VALUES.FAQ)).toBe(false)
  })

  it("extracts offer-probe suggestedAction from chat results", () => {
    expect(
      chatResultSuggestedAction({
        artifact: {
          schema: "@executioncontrolprotocol.harness.reply",
          answer: "Want me to run the probe?",
          suggestedAction: "offer-probe",
        },
        raw: "",
        trace: { harness: "@executioncontrolprotocol/harness-browser-coding" },
      })
    ).toBe("offer-probe")
  })

  it("extracts answer, suggestedAction, and workflow from chat results", () => {
    expect(
      chatResultAnswer({
        artifact: { schema: "@executioncontrolprotocol.harness.reply", answer: "hello" },
        raw: "",
        trace: { harness: "@executioncontrolprotocol/harness-browser-coding" },
      })
    ).toBe("hello")
    expect(
      chatResultSuggestedAction({
        artifact: {
          schema: "@executioncontrolprotocol.harness.reply",
          answer: "Updated. Want me to run it?",
          suggestedAction: "offer-run",
        },
        raw: "",
        trace: { harness: "@executioncontrolprotocol/harness-browser-coding" },
      })
    ).toBe("offer-run")
    expect(
      chatResultWorkflow({
        artifact: {
          schema: "@executioncontrolprotocol.harness.reply",
          answer: "Updated.",
          suggestedAction: "offer-run",
        },
        workflow: {
          schema: "@executioncontrolprotocol.workflow",
          version: "1.0",
          workflow: { id: "w", label: "W" },
          steps: [],
        },
        raw: "",
        trace: { harness: "@executioncontrolprotocol/harness-browser-coding" },
      })?.workflow.id
    ).toBe("w")
    expect(
      chatResultWorkflow({
        artifact: {
          schema: "@executioncontrolprotocol.workflow",
          version: "1.0",
          workflow: { id: "legacy", label: "Legacy" },
          steps: [],
        },
        raw: "",
        trace: { harness: "@executioncontrolprotocol/harness-browser-coding" },
      })?.workflow.id
    ).toBe("legacy")
  })
})
