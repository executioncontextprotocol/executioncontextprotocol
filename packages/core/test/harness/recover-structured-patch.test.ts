import { describe, expect, it } from "vitest"
import { recoverStructuredPatchFromRequest } from "../../src/harness/authoring/recover-structured-patch.js"
import {
  createEqlIncludesRequiredCapabilities,
  synthesizeCreateEqlFromRequiredCapabilities,
} from "../../src/harness/authoring/normalize-create-eql-output.js"

describe("recoverStructuredPatchFromRequest", () => {
  it("rebuilds DELETE STEP for remove requests", () => {
    expect(
      recoverStructuredPatchFromRequest("PATCH WORKFLOW multi-cap\nUPDATE WORKFLOW", {
        request: "Remove the notify step from the workflow.",
        workflowId: "multi-cap",
        stepIds: ["validate", "echo", "notify"],
      })
    ).toBe(`PATCH WORKFLOW multi-cap
DELETE STEP notify`)
  })

  it("rebuilds ADD STEP after anchor", () => {
    expect(
      recoverStructuredPatchFromRequest("PATCH WORKFLOW echo-test\nUPDATE WORKFLOW", {
        request:
          "Add a summarize step after echo using @executioncontrolprotocol/test.summarize.",
        workflowId: "echo-test",
        stepIds: ["echo"],
        capabilityIds: ["@executioncontrolprotocol/test.summarize"],
      })
    ).toBe(`PATCH WORKFLOW echo-test
ADD STEP summarize USES @executioncontrolprotocol/test.summarize AFTER echo`)
  })

  it("rebuilds ADD STEP before anchor", () => {
    expect(
      recoverStructuredPatchFromRequest("PATCH WORKFLOW echo-test\nUPDATE WORKFLOW", {
        request:
          "Insert a validate step before echo using @executioncontrolprotocol/test.validate.",
        workflowId: "echo-test",
        stepIds: ["echo"],
        capabilityIds: ["@executioncontrolprotocol/test.validate"],
      })
    ).toBe(`PATCH WORKFLOW echo-test
ADD STEP validate USES @executioncontrolprotocol/test.validate BEFORE echo`)
  })

  it("rebuilds echo input value patch", () => {
    expect(
      recoverStructuredPatchFromRequest("PATCH WORKFLOW echo-test\nUPDATE WORKFLOW", {
        request: "Set echo input value to recovered.",
        workflowId: "echo-test",
        stepIds: ["echo"],
      })
    ).toBe(`PATCH WORKFLOW echo-test
UPDATE STEP echo
  WITH value = "recovered"`)
  })

  it("rebuilds MOVE STEP for reorder requests", () => {
    expect(
      recoverStructuredPatchFromRequest(
        "PATCH WORKFLOW echo-validate\nUPDATE WORKFLOW\n  LABEL \"Echo validate reorder\"\nADD STEP translate USES @executioncontrolprotocol/test.translate AFTER echo",
        {
          request: "Move the echo step to run after validate.",
          workflowId: "echo-validate",
          stepIds: ["echo", "validate"],
        }
      )
    ).toBe(`PATCH WORKFLOW echo-validate
MOVE STEP echo AFTER validate`)
  })

  it("rebuilds combined DELETE and ADD patch", () => {
    expect(
      recoverStructuredPatchFromRequest(
        "PATCH WORKFLOW two-step-chain\nADD STEP translate USES @executioncontrolprotocol/test.translate AFTER echo",
        {
          request: "Add translate after echo and remove summarize if present.",
          workflowId: "two-step-chain",
          stepIds: ["echo", "summarize"],
          capabilityIds: ["@executioncontrolprotocol/test.translate"],
        }
      )
    ).toBe(`PATCH WORKFLOW two-step-chain
DELETE STEP summarize
ADD STEP translate USES @executioncontrolprotocol/test.translate AFTER echo
  WITH text = REF echo.output
  AS translate`)
  })

  it("rebuilds DELETE for every step on remove-all", () => {
    expect(
      recoverStructuredPatchFromRequest("PATCH WORKFLOW haiku-explain\nUPDATE WORKFLOW", {
        request: "Remove all steps from the workflow.",
        workflowId: "haiku-explain",
        stepIds: ["haiku", "explain"],
      })
    ).toBe(`PATCH WORKFLOW haiku-explain
DELETE STEP haiku
DELETE STEP explain`)
  })

  it("rebuilds clear-all then ADD on start-fresh with capability", () => {
    expect(
      recoverStructuredPatchFromRequest("PATCH WORKFLOW haiku-explain\nDELETE STEP haiku", {
        request:
          "Clear the workflow and start fresh with one @executioncontrolprotocol/chrome-ai.generate step that writes a haiku.",
        workflowId: "haiku-explain",
        stepIds: ["haiku", "explain"],
        capabilityIds: ["@executioncontrolprotocol/chrome-ai.generate"],
      })
    ).toBe(`PATCH WORKFLOW haiku-explain
DELETE STEP haiku
DELETE STEP explain
ADD STEP generate USES @executioncontrolprotocol/chrome-ai.generate
  LABEL "Generate"
  WITH prompt = "Write a haiku."
  AS generate`)
  })
})

describe("synthesizeCreateEqlFromRequiredCapabilities", () => {
  const required = [
    "@executioncontrolprotocol/test.validate",
    "@executioncontrolprotocol/test.echo",
    "@executioncontrolprotocol/test.summarize",
  ]

  it("builds all required steps in request order", () => {
    const synthesized = synthesizeCreateEqlFromRequiredCapabilities(
      "Create a 3-step workflow using @executioncontrolprotocol/test.validate, @executioncontrolprotocol/test.echo, and @executioncontrolprotocol/test.summarize.",
      required
    )
    expect(synthesized).toContain("STEP validate USES @executioncontrolprotocol/test.validate")
    expect(synthesized).toContain("STEP echo USES @executioncontrolprotocol/test.echo")
    expect(synthesized).toContain("STEP summarize USES @executioncontrolprotocol/test.summarize")
    expect(createEqlIncludesRequiredCapabilities(synthesized!, required)).toBe(true)
  })
})
