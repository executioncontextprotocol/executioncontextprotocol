import { describe, it } from "vitest"
import {
  anthropicEvalReady,
  runEvalCase,
  type EvalSuite,
} from "@executioncontrolprotocol/evals"
import {
  BROWSER_CODING_HARNESS_CAPABILITY,
  createCodingAnthropicMatrixEnvironment,
} from "./coding-matrix-environment.js"
import { codingEvalFixturesLoader, loadCodingEvalCases } from "./coding-eval-fixtures.js"
import { CODING_MATRIX_EVAL_EXTENSION_IDS } from "./coding-matrix-extensions.js"

const readiness = await anthropicEvalReady()

const runOptions = {
  fixturesLoader: codingEvalFixturesLoader,
  harnessCapability: BROWSER_CODING_HARNESS_CAPABILITY,
  descriptorExtensionIds: CODING_MATRIX_EVAL_EXTENSION_IDS,
}

/** Register a coding matrix suite gated on Anthropic API key readiness. */
export function describeCodingAnthropicMatrix(suite: EvalSuite, label: string): void {
  const cases = loadCodingEvalCases({ suite })
  describe.skipIf(!readiness.ready)(
    `matrix ${label} (${readiness.profileId} ${readiness.model})`,
    () => {
      it.each(cases)("$id: $title", async (caseRow) => {
        const env = await createCodingAnthropicMatrixEnvironment()
        const ecp = await env.init()
        try {
          await runEvalCase(ecp, env, caseRow, runOptions)
        } finally {
          await ecp.terminate()
        }
      })
    }
  )
}
