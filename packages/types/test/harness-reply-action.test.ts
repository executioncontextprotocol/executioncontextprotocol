import { describe, expect, it } from "vitest"
import { harnessReplySchema } from "@executioncontrolprotocol/types"

describe("harnessReplySchema suggestedAction", () => {
  it("accepts optional offer-run", () => {
    const parsed = harnessReplySchema.parse({
      schema: "@executioncontrolprotocol.harness.reply",
      answer: "Updated. Want me to run it?",
      suggestedAction: "offer-run",
    })
    expect(parsed.suggestedAction).toBe("offer-run")
  })

  it("rejects invalid suggestedAction", () => {
    expect(() =>
      harnessReplySchema.parse({
        schema: "@executioncontrolprotocol.harness.reply",
        answer: "Hi",
        suggestedAction: "delete-all",
      })
    ).toThrow()
  })

  it("allows missing suggestedAction", () => {
    const parsed = harnessReplySchema.parse({
      schema: "@executioncontrolprotocol.harness.reply",
      answer: "ECP is a protocol.",
    })
    expect(parsed.suggestedAction).toBeUndefined()
  })
})
