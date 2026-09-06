import { describe, expect, it } from "vitest"
import {
  ECP_HARNESS_REPLY_CITATION_KINDS,
  ECP_HARNESS_REPLY_SCHEMA,
  ECP_INTENT_SCHEMA,
  ECP_INTENT_VALUES,
  type EcpIntent,
  type HarnessReply,
} from "@executioncontrolprotocol/types"
import { decodeFromEql } from "../src/decode/decode-eql.js"
import { encodeToEql } from "../src/encode/encode-eql.js"
import { testCtx } from "./helpers.js"

describe("EQL @executioncontrolprotocol.intent", () => {
  const intent: EcpIntent = {
    schema: ECP_INTENT_SCHEMA,
    intent: ECP_INTENT_VALUES.WORKFLOW_CREATE,
  }

  it("round-trips with header", () => {
    const encoded = encodeToEql(
      { source: intent, sourceSchema: ECP_INTENT_SCHEMA },
      testCtx
    )
    expect(encoded.success).toBe(true)
    expect(encoded.result).toContain("ECP @executioncontrolprotocol.intent")
    expect(encoded.result).toContain("INTENT workflow-create")

    const decoded = decodeFromEql(
      { input: encoded.result, targetSchema: ECP_INTENT_SCHEMA },
      testCtx
    )
    expect(decoded.success).toBe(true)
    expect(decoded.result).toEqual(intent)
  })

  it("round-trips headerless", () => {
    const encoded = encodeToEql(
      {
        source: intent,
        sourceSchema: ECP_INTENT_SCHEMA,
        options: { headers: false },
      },
      testCtx
    )
    expect(encoded.result).not.toMatch(/^ECP /m)
    expect(encoded.result.trim()).toBe("INTENT workflow-create")

    const decoded = decodeFromEql(
      {
        input: encoded.result,
        targetSchema: ECP_INTENT_SCHEMA,
        options: { headers: false },
      },
      testCtx
    )
    expect(decoded.success).toBe(true)
    expect(decoded.result).toEqual(intent)
  })

  it("round-trips optional topic and summary", () => {
    const richIntent: EcpIntent = {
      schema: ECP_INTENT_SCHEMA,
      intent: ECP_INTENT_VALUES.FAQ,
      topic: "patching",
      summary: "User asks how patching works",
    }
    const encoded = encodeToEql(
      {
        source: richIntent,
        sourceSchema: ECP_INTENT_SCHEMA,
        options: { headers: false },
      },
      testCtx
    )
    const decoded = decodeFromEql(
      {
        input: encoded.result,
        targetSchema: ECP_INTENT_SCHEMA,
        options: { headers: false },
      },
      testCtx
    )
    expect(decoded.success).toBe(true)
    expect(decoded.result).toEqual(richIntent)
  })
})

describe("EQL @executioncontrolprotocol.harness.reply", () => {
  const reply: HarnessReply = {
    schema: ECP_HARNESS_REPLY_SCHEMA,
    answer: "The echo step completed successfully.",
    citations: [
      {
        kind: ECP_HARNESS_REPLY_CITATION_KINDS.STEP,
        id: "echo",
        detail: "Step output",
      },
    ],
  }

  it("round-trips with header", () => {
    const encoded = encodeToEql(
      { source: reply, sourceSchema: ECP_HARNESS_REPLY_SCHEMA },
      testCtx
    )
    expect(encoded.success).toBe(true)
    expect(encoded.result).toContain("REPLY")
    expect(encoded.result).toContain('ANSWER "The echo step completed successfully."')
    expect(encoded.result).toContain("CITATION step echo")

    const decoded = decodeFromEql(
      { input: encoded.result, targetSchema: ECP_HARNESS_REPLY_SCHEMA },
      testCtx
    )
    expect(decoded.success).toBe(true)
    expect(decoded.result).toEqual(reply)
  })

  it("round-trips headerless", () => {
    const encoded = encodeToEql(
      {
        source: reply,
        sourceSchema: ECP_HARNESS_REPLY_SCHEMA,
        options: { headers: false },
      },
      testCtx
    )
    expect(encoded.result).not.toMatch(/^ECP /m)

    const decoded = decodeFromEql(
      {
        input: encoded.result,
        targetSchema: ECP_HARNESS_REPLY_SCHEMA,
        options: { headers: false },
      },
      testCtx
    )
    expect(decoded.success).toBe(true)
    expect(decoded.result).toEqual(reply)
  })

  it("decodes minimal reply without citations", () => {
    const text = `REPLY
  ANSWER "Hello"`
    const decoded = decodeFromEql(
      {
        input: text,
        targetSchema: ECP_HARNESS_REPLY_SCHEMA,
        options: { headers: false },
      },
      testCtx
    )
    expect(decoded.success).toBe(true)
    expect(decoded.result).toEqual({
      schema: ECP_HARNESS_REPLY_SCHEMA,
      answer: "Hello",
    })
  })

  it("round-trips ACTION offer-run", () => {
    const withAction: HarnessReply = {
      schema: ECP_HARNESS_REPLY_SCHEMA,
      answer: "I added a summarize step. Want me to run it?",
      suggestedAction: "offer-run",
    }
    const encoded = encodeToEql(
      { source: withAction, sourceSchema: ECP_HARNESS_REPLY_SCHEMA },
      testCtx
    )
    expect(encoded.success).toBe(true)
    expect(encoded.result).toContain("ACTION offer-run")

    const decoded = decodeFromEql(
      { input: encoded.result, targetSchema: ECP_HARNESS_REPLY_SCHEMA },
      testCtx
    )
    expect(decoded.success).toBe(true)
    expect(decoded.result).toEqual(withAction)
  })
})
