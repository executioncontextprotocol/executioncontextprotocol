import { describe, expect, it } from "vitest"
import type { HarnessInvokeResult, WorkflowManifest } from "@executioncontrolprotocol/types"
import type { DeterministicAssertion } from "../../src/fixtures/eval-case-schema.js"
import { extractAssertionActual } from "../../src/fixtures/eval-debug.js"

function workflowArtifact(overrides: Partial<WorkflowManifest["workflow"]> = {}): HarnessInvokeResult {
  const manifest: WorkflowManifest = {
    schema: "@executioncontrolprotocol.workflow",
    version: "1.0",
    workflow: {
      id: "echo-from-input",
      label: "Echo from input",
      accepts: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
      returns: {
        type: "object",
        properties: { echo: { type: "object" } },
        required: ["echo"],
      },
      ...overrides,
    },
    steps: [
      {
        type: "step",
        id: "echo",
        uses: "@executioncontrolprotocol/test.echo",
        input: { value: { $ref: "state.value" } },
        as: "echo",
      },
    ],
  }
  return { artifact: manifest, validation: { valid: true } }
}

describe("workflow I/O eval assertions debug", () => {
  it("describes workflowAcceptsHasProperties", async () => {
    const assertion: DeterministicAssertion = {
      kind: "workflowAcceptsHasProperties",
      properties: ["value"],
    }
    const actual = await extractAssertionActual(assertion, workflowArtifact())
    expect(actual).toContain("value")
  })

  it("describes workflowAcceptsRefUsed", async () => {
    const assertion: DeterministicAssertion = {
      kind: "workflowAcceptsRefUsed",
      property: "value",
    }
    const actual = await extractAssertionActual(assertion, workflowArtifact())
    expect(actual).toContain("state.value")
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
      property: "echo",
      type: "object",
    }
    const actual = await extractAssertionActual(assertion, workflowArtifact())
    expect(actual).toContain("echo")
    expect(actual).toContain("object")
  })
})
