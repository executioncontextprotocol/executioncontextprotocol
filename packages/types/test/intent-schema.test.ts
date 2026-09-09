import { describe, expect, it } from "vitest"
import {
  ECP_HARNESS_REPLY_ACTIONS,
  ECP_INTENT_VALUES,
  ecpIntentSchema,
  harnessReplySchema,
  probeContextSchema,
} from "@executioncontrolprotocol/types"

describe("ecpIntentSchema", () => {
  it("parses workflow-probe and workflow-clarify", () => {
    expect(
      ecpIntentSchema.parse({
        schema: "@executioncontrolprotocol.intent",
        intent: ECP_INTENT_VALUES.WORKFLOW_PROBE,
        topic: "photoshop-layers",
        summary: "Discover layers first",
      }).intent
    ).toBe("workflow-probe")
    expect(
      ecpIntentSchema.parse({
        schema: "@executioncontrolprotocol.intent",
        intent: ECP_INTENT_VALUES.WORKFLOW_CLARIFY,
      }).intent
    ).toBe("workflow-clarify")
  })

  it("rejects unknown intents", () => {
    expect(() =>
      ecpIntentSchema.parse({
        schema: "@executioncontrolprotocol.intent",
        intent: "workflow-inspect",
      })
    ).toThrow()
  })

  it("enforces topic/summary max length", () => {
    expect(() =>
      ecpIntentSchema.parse({
        schema: "@executioncontrolprotocol.intent",
        intent: "faq",
        topic: "x".repeat(81),
      })
    ).toThrow()
    expect(() =>
      ecpIntentSchema.parse({
        schema: "@executioncontrolprotocol.intent",
        intent: "faq",
        summary: "y".repeat(201),
      })
    ).toThrow()
  })
})

describe("harnessReplySchema actions", () => {
  it("accepts offer-probe and offer-run", () => {
    expect(
      harnessReplySchema.parse({
        schema: "@executioncontrolprotocol.harness.reply",
        answer: "Run probe?",
        suggestedAction: ECP_HARNESS_REPLY_ACTIONS.OFFER_PROBE,
      }).suggestedAction
    ).toBe("offer-probe")
    expect(
      harnessReplySchema.parse({
        schema: "@executioncontrolprotocol.harness.reply",
        answer: "Run it?",
        suggestedAction: ECP_HARNESS_REPLY_ACTIONS.OFFER_RUN,
      }).suggestedAction
    ).toBe("offer-run")
  })

  it("rejects unknown actions and allows omitted action", () => {
    expect(() =>
      harnessReplySchema.parse({
        schema: "@executioncontrolprotocol.harness.reply",
        answer: "Hi",
        suggestedAction: "offer-dance",
      })
    ).toThrow()
    expect(
      harnessReplySchema.parse({
        schema: "@executioncontrolprotocol.harness.reply",
        answer: "Hi",
      }).suggestedAction
    ).toBeUndefined()
  })
})

describe("probeContextSchema", () => {
  it("parses options and rejects empty ids", () => {
    const parsed = probeContextSchema.parse({
      probeId: "p1",
      domain: "photoshop-layers",
      summary: "Found layers",
      options: [{ id: "1", label: "Headline" }],
    })
    expect(parsed.options[0]?.label).toBe("Headline")
    expect(() =>
      probeContextSchema.parse({
        probeId: "p1",
        domain: "photoshop-layers",
        summary: "x",
        options: [{ id: "", label: "Bad" }],
      })
    ).toThrow()
  })
})
