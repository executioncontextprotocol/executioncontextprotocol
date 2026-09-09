import { describe, expect, it } from "vitest"
import { loadNanoEvalCases, countNanoEvalCases } from "./helpers/nano-eval-fixtures.js"
import { NANO_MATRIX_EVAL_EXTENSION_IDS } from "./helpers/nano-matrix-extensions.js"

describe("nano eval matrix fixtures", () => {
  it("loads 116 Ollama eval cases", () => {
    expect(countNanoEvalCases()).toBe(116)
  })

  it("matrix extension binding list has four extensions", () => {
    expect(NANO_MATRIX_EVAL_EXTENSION_IDS).toEqual([
      "@executioncontrolprotocol/format-toon",
      "@executioncontrolprotocol/format-eql",
      "@executioncontrolprotocol/format-json",
      "@executioncontrolprotocol/test",
    ])
  })

  it("assigns unique case ids", () => {
    const cases = loadNanoEvalCases({ excludeSkipped: false })
    const ids = cases.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
