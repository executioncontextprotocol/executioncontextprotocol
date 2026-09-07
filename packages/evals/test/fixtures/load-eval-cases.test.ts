import { describe, expect, it } from "vitest"
import {
  createNodeEvalFixturesLoader,
  EVAL_SUITE_VALUES,
} from "../../src/fixtures/load-eval-cases.js"
import { NANO_EVAL_CASES_DIR, NANO_EVAL_FIXTURES_ROOT } from "../../../harnesses/browser-nano/test/eval/helpers/fixtures-root.js"

const nanoLoader = createNodeEvalFixturesLoader({
  fixturesRoot: NANO_EVAL_FIXTURES_ROOT,
  casesDir: NANO_EVAL_CASES_DIR,
})

describe("loadEvalCasesFromDir", () => {
  it("loads 97 cases across suites from harness-owned fixtures", () => {
    expect(nanoLoader.loadEvalCases().length).toBe(97)
    expect(nanoLoader.countEvalCases()).toBe(97)
  })

  it("loads workflow-create suite", () => {
    const cases = nanoLoader.loadEvalCases({ suite: EVAL_SUITE_VALUES.WORKFLOW_CREATE })
    expect(cases.length).toBe(19)
  })

  it("loads harness run fixture", () => {
    const ctx = nanoLoader.loadHarnessRunFixture("failed-generate-step.json")
    expect(ctx.run.run.status).toBe("failed")
  })
})
