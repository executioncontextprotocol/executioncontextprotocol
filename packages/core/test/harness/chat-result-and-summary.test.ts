import { describe, expect, it } from "vitest"
import {
  buildAuthoringFailureReply,
  chatResultAnswer,
  chatResultSuggestedAction,
  chatResultWorkflow,
  tryBuildChangeSummaryReply,
} from "../../src/harness/authoring/index.js"
import type { WorkflowManifest } from "@executioncontrolprotocol/types"

const echoWorkflow: WorkflowManifest = {
  schema: "@executioncontrolprotocol.workflow",
  version: "1.0",
  workflow: { id: "echo-test", label: "Echo test" },
  steps: [
    {
      type: "step",
      id: "echo",
      uses: "@executioncontrolprotocol/test.echo",
      label: "Echo",
      input: { value: "hi" },
      as: "echo",
    },
  ],
}

describe("tryBuildChangeSummaryReply", () => {
  it("summarizes create and offers run", () => {
    const reply = tryBuildChangeSummaryReply(undefined, echoWorkflow)
    expect(reply.suggestedAction).toBe("offer-run")
    expect(reply.answer.toLowerCase()).toContain("created")
    expect(reply.answer.toLowerCase()).toContain("run")
  })

  it("summarizes label patch and offers run", () => {
    const patched: WorkflowManifest = {
      ...echoWorkflow,
      steps: [
        {
          type: "step",
          id: "echo",
          uses: "@executioncontrolprotocol/test.echo",
          label: "Patched Echo",
          input: { value: "hi" },
          as: "echo",
        },
      ],
    }
    const reply = tryBuildChangeSummaryReply(echoWorkflow, patched)
    expect(reply.suggestedAction).toBe("offer-run")
    expect(reply.answer.toLowerCase()).toMatch(/label|updated|patched/)
    expect(reply.answer.toLowerCase()).toContain("run")
  })

  it("still offers run when the diff is empty", () => {
    const reply = tryBuildChangeSummaryReply(echoWorkflow, echoWorkflow)
    expect(reply.suggestedAction).toBe("offer-run")
    expect(reply.answer.toLowerCase()).toContain("run")
  })
})

describe("buildAuthoringFailureReply", () => {
  it("never offers run", () => {
    const reply = buildAuthoringFailureReply("decode failed")
    expect(reply.suggestedAction).toBeUndefined()
    expect(reply.answer.toLowerCase()).toContain("could not")
  })
})

describe("chatResult helpers", () => {
  const replyTrace = { harness: "@executioncontrolprotocol/harness-browser-nano" as const }

  it("reads answer and suggestedAction from reply artifact", () => {
    const result = {
      artifact: {
        schema: "@executioncontrolprotocol.harness.reply" as const,
        answer: "Updated. Want me to run it?",
        suggestedAction: "offer-run" as const,
      },
      raw: "",
      workflow: echoWorkflow,
      trace: replyTrace,
    }
    expect(chatResultAnswer(result)).toBe("Updated. Want me to run it?")
    expect(chatResultSuggestedAction(result)).toBe("offer-run")
    expect(chatResultWorkflow(result)?.workflow.id).toBe("echo-test")
  })

  it("falls back to legacy workflow-as-artifact", () => {
    expect(
      chatResultWorkflow({
        artifact: echoWorkflow,
        raw: "",
        trace: replyTrace,
      })?.workflow.id
    ).toBe("echo-test")
  })

  it("returns undefined suggestedAction when absent", () => {
    expect(
      chatResultSuggestedAction({
        artifact: {
          schema: "@executioncontrolprotocol.harness.reply",
          answer: "ECP is a protocol.",
        },
        raw: "",
        trace: replyTrace,
      })
    ).toBeUndefined()
  })
})
