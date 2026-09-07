import { describe, expect, it } from "vitest"
import { compileWorkflowSource } from "@executioncontrolprotocol/core/compile"
import { renderWorkflowToFluent } from "@executioncontrolprotocol/core"

const SAMPLE = `
import { workflow, step } from "@executioncontrolprotocol/core"
export default workflow("Patch target")
  .run([
    step("@executioncontrolprotocol/chrome-ai.generate", "Generate Poem")
      .with({ prompt: "Write a short poem about the ocean." })
      .as("poem"),
  ])
`

describe("Browser Coding workflow Fluent compile", () => {
  it("compiles model-style Fluent output", async () => {
    const result = await compileWorkflowSource({ source: SAMPLE, filename: "workflow.ts" })
    expect(result.ok).toBe(true)
    expect(result.manifest?.steps[0]?.as).toBe("poem")
  })

  it("renders baseline Fluent for patch prompts", async () => {
    const compiled = await compileWorkflowSource({ source: SAMPLE, filename: "workflow.ts" })
    expect(compiled.manifest).toBeDefined()
    const fluent = renderWorkflowToFluent(compiled.manifest!)
    expect(fluent).toContain("export default workflow")
    expect(fluent).toContain("@executioncontrolprotocol/chrome-ai.generate")
  })
})
