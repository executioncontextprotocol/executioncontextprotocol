import { describe, expect, it } from "vitest"
import type { HarnessInvokeResult, WorkflowManifest } from "@executioncontrolprotocol/types"
import type { DeterministicAssertion } from "../../src/fixtures/eval-case-schema.js"
import { extractAssertionActual } from "../../src/fixtures/eval-debug.js"

function workflowArtifact(overrides: Partial<WorkflowManifest["workflow"]> = {}): HarnessInvokeResult {
  const manifest: WorkflowManifest = {
    schema: "@executioncontrolprotocol.workflow",
    version: "1.0",
    workflow: {
      id: "generate-from-prompt",
      label: "Generate from prompt",
      accepts: {
        type: "object",
        properties: { prompt: { type: "string" } },
        required: ["prompt"],
      },
      returns: {
        type: "object",
        properties: { response: { type: "object" } },
        required: ["response"],
      },
      ...overrides,
    },
    steps: [
      {
        type: "step",
        id: "generate",
        uses: "@executioncontrolprotocol/chrome-ai.generate",
        input: { prompt: { $ref: "state.prompt" } },
        as: "response",
      },
    ],
  }
  return { artifact: manifest, validation: { valid: true } }
}

describe("workflow I/O eval assertions debug", () => {
  it("describes workflowAcceptsHasProperties", async () => {
    const assertion: DeterministicAssertion = {
      kind: "workflowAcceptsHasProperties",
      properties: ["prompt"],
    }
    const actual = await extractAssertionActual(assertion, workflowArtifact())
    expect(actual).toContain("prompt")
  })

  it("describes workflowAcceptsRefUsed", async () => {
    const assertion: DeterministicAssertion = {
      kind: "workflowAcceptsRefUsed",
      property: "prompt",
    }
    const actual = await extractAssertionActual(assertion, workflowArtifact())
    expect(actual).toContain("state.prompt")
  })

  it("describes workflowReturnsAbsent when missing", async () => {
    const assertion: DeterministicAssertion = { kind: "workflowReturnsAbsent" }
    const actual = await extractAssertionActual(
      assertion,
      workflowArtifact({ returns: undefined })
    )
    expect(actual).toContain("absent")
  })

  it("describes workflowReturnsPropertyType", async () => {
    const assertion: DeterministicAssertion = {
      kind: "workflowReturnsPropertyType",
      property: "response",
      type: "object",
    }
    const actual = await extractAssertionActual(assertion, workflowArtifact())
    expect(actual).toContain("response")
    expect(actual).toContain("object")
  })
})
