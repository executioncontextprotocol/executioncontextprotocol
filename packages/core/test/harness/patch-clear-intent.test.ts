import { describe, expect, it } from "vitest"
import {
  isClearAllStepsRequest,
  isClearAndRebuildRequest,
} from "../../src/harness/authoring/patch-clear-intent.js"

describe("isClearAllStepsRequest", () => {
  it("matches remove-all / clear / start-fresh phrasings", () => {
    expect(isClearAllStepsRequest("Remove all steps from the workflow.")).toBe(true)
    expect(isClearAllStepsRequest("Clear the workflow.")).toBe(true)
    expect(isClearAllStepsRequest("Clear the steps but keep accepts and returns.")).toBe(true)
    expect(isClearAllStepsRequest("Start fresh.")).toBe(true)
    expect(isClearAllStepsRequest("Wipe all steps.")).toBe(true)
    expect(isClearAllStepsRequest("Empty the workflow.")).toBe(true)
    expect(isClearAllStepsRequest("Delete every step.")).toBe(true)
  })

  it("does not match single-step remove or I/O-only clears", () => {
    expect(isClearAllStepsRequest("Remove the critique step from the workflow.")).toBe(false)
    expect(isClearAllStepsRequest("Remove workflow returns with CLEAR RETURNS.")).toBe(false)
    expect(isClearAllStepsRequest("CLEAR RETURNS")).toBe(false)
    expect(isClearAllStepsRequest("CLEAR ACCEPTS")).toBe(false)
    expect(isClearAllStepsRequest("Change the poem step label to Draft Poem.")).toBe(false)
  })
})

describe("isClearAndRebuildRequest", () => {
  it("matches clear then rebuild with a capability", () => {
    expect(
      isClearAndRebuildRequest(
        "Clear the workflow and start fresh with one @executioncontrolprotocol/chrome-ai.generate step that writes a haiku."
      )
    ).toBe(true)
  })

  it("does not treat clear-only as rebuild", () => {
    expect(isClearAndRebuildRequest("Remove all steps from the workflow.")).toBe(false)
    expect(isClearAndRebuildRequest("Remove the critique step.")).toBe(false)
  })
})
