import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  buildNanoRepairHint,
  buildNanoSystemPrompt,
  loadNanoHarnessPromptFixture,
  NANO_PROMPT_FIXTURE_IDS,
} from "../src/prompts/index.js"

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), "../src/prompts")

describe("browser-nano harness prompt fixtures", () => {
  it("browser loader glob resolves to package harness-prompts fixtures", () => {
    const browserLoader = join(promptsDir, "load-harness-prompt.browser.ts")
    const source = readFileSync(browserLoader, "utf8")
    expect(source).toMatch(/import\.meta\.glob\("\.\.\/\.\.\/fixtures\/harness-prompts\/\*\.prompt\.json"/)
    expect(
      existsSync(
        join(promptsDir, "../../fixtures/harness-prompts/intent-classification.prompt.json"),
      ),
    ).toBe(true)
    expect(
      existsSync(
        join(promptsDir, "../../../fixtures/harness-prompts/intent-classification.prompt.json"),
      ),
    ).toBe(false)
  })

  it("loads intent-classification fixture", () => {
    const fixture = loadNanoHarnessPromptFixture(NANO_PROMPT_FIXTURE_IDS.INTENT_CLASSIFICATION)
    expect(fixture.fewShots?.length).toBeGreaterThanOrEqual(4)
    expect(fixture.definitions?.length).toBe(6)
    expect(fixture.allowedValues?.intent).toEqual([
      "faq",
      "workflow-create",
      "workflow-patch",
      "workflow-probe",
      "workflow-clarify",
      "general",
    ])
    expect(fixture.promptFormat).toBe("eql")
  })

  it("buildNanoSystemPrompt uses EQL examples for intent classification", () => {
    const system = buildNanoSystemPrompt(NANO_PROMPT_FIXTURE_IDS.INTENT_CLASSIFICATION)
    expect(system).toContain("INTENT workflow-create")
    expect(system).toContain("Additional examples (message -> EQL output)")
    expect(system).toContain("Reply with SQL-like EQL only")
  })

  it("buildNanoRepairHint references valid EQL example", () => {
    const hint = buildNanoRepairHint(NANO_PROMPT_FIXTURE_IDS.WORKFLOW_ASSISTANT)
    expect(hint).toContain("REPLY")
    expect(hint).toContain("ANSWER")
  })

  it("workflow create few-shots use unique STEP ids", () => {
    const fixture = loadNanoHarnessPromptFixture(NANO_PROMPT_FIXTURE_IDS.WORKFLOW_AUTHORING_CREATE)
    for (const shot of fixture.fewShots ?? []) {
      if (typeof shot.output !== "string") continue
      const stepIds = [...shot.output.matchAll(/^STEP\s+(\S+)\s+USES/gm)].map((m) => m[1]!)
      expect(new Set(stepIds).size, shot.message).toBe(stepIds.length)
    }
  })
})
