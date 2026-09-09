import { describe, expect, it } from "vitest"
import { countCodingEvalCases, loadCodingEvalCases } from "./helpers/coding-eval-fixtures.js"
import { CODING_MATRIX_EVAL_EXTENSION_IDS } from "./helpers/coding-matrix-extensions.js"

describe("coding eval matrix fixtures", () => {
  it("loads 100 Ollama eval cases", () => {
    expect(countCodingEvalCases()).toBe(100)
  })

  it("matrix extension binding list has four extensions", () => {
    expect(CODING_MATRIX_EVAL_EXTENSION_IDS).toEqual([
      "@executioncontrolprotocol/format-toon",
      "@executioncontrolprotocol/format-eql",
      "@executioncontrolprotocol/format-json",
      "@executioncontrolprotocol/test",
    ])
  })

  it("assigns unique case ids", () => {
    const cases = loadCodingEvalCases({ excludeSkipped: false })
    const ids = cases.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
