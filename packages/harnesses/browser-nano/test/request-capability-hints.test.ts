import { describe, expect, it } from "vitest"
import {
  buildPatchOperationHintLines,
  buildRequestCapabilityHintLines,
  collectCreateCapabilityFeedback,
  collectCreateDuplicateStepIdFeedback,
  collectCreateWorkflowIoFeedback,
  collectGenerateReturnsTypeFeedback,
  collectPatchGoalFeedback,
  inferPatchTargetStepId,
  inferRequiredCapabilityIds,
  inferRequiredStepCount,
} from "../src/_internal/request-capability-hints.js"
import type { CompactEnvironmentSummary } from "@executioncontrolprotocol/core"
import type { WorkflowManifest } from "@executioncontrolprotocol/types"

const CHROME_GEN = "@executioncontrolprotocol/chrome-ai.generate"
const OLLAMA_GEN = "@executioncontrolprotocol/ollama.generate"

const EMAIL_QUICKSTART =
  "Build a workflow that uses Chrome AI to generate a short sample email with a meeting summary, then extract key action items from it in a second step."
const HAIKU_QUICKSTART =
  "Create a two-step workflow: Chrome AI writes a haiku, then Chrome AI explains what it means."
const TRIVIA_QUICKSTART =
  "Build a three-step Chrome AI workflow: ask a trivia question, draft an answer, then critique the answer."

const summary: CompactEnvironmentSummary = {
  extensions: [
    {
      id: "@executioncontrolprotocol/chrome-ai",
      capabilities: [CHROME_GEN],
    },
    {
      id: "@executioncontrolprotocol/ollama",
      capabilities: [OLLAMA_GEN],
    },
  ],
  capabilities: [
    {
      id: CHROME_GEN,
      extension: "@executioncontrolprotocol/chrome-ai",
      inputs: ["prompt"],
      outputs: ["text"],
    },
    {
      id: OLLAMA_GEN,
      extension: "@executioncontrolprotocol/ollama",
      inputs: ["prompt"],
      outputs: ["text"],
    },
  ],
}

function poemSummarizeWorkflow(): WorkflowManifest {
  return {
    schema: "@executioncontrolprotocol.workflow",
    version: "1.0.0",
    workflow: { id: "poem-summarize", label: "Poem Summarization" },
    steps: [
      {
        type: "step",
        id: "poem",
        uses: CHROME_GEN,
        label: "Generate Poem",
        as: "poem",
      },
      {
        type: "step",
        id: "summarize",
        uses: CHROME_GEN,
        label: "Summarize Poem",
        as: "summary",
      },
    ],
  }
}

function emailActionWorkflow(): WorkflowManifest {
  return {
    schema: "@executioncontrolprotocol.workflow",
    version: "1.0.0",
    workflow: { id: "email-action", label: "Email Action" },
    steps: [
      { type: "step", id: "email", uses: CHROME_GEN, label: "Generate Email", as: "email" },
      {
        type: "step",
        id: "actions",
        uses: CHROME_GEN,
        label: "Extract Action Items",
        as: "actions",
      },
    ],
  }
}

describe("request-capability-hints", () => {
  it("infers chrome-ai.generate and ollama.generate from capability ids in request", () => {
    const ids = inferRequiredCapabilityIds(
      `Create a workflow with ${CHROME_GEN} then ${OLLAMA_GEN}`,
      summary.capabilities.map((c) => c.id)
    )
    expect(ids).toContain(CHROME_GEN)
    expect(ids).toContain(OLLAMA_GEN)
  })

  it("infers chrome-ai.generate when Chrome AI appears in request", () => {
    const ids = inferRequiredCapabilityIds(
      EMAIL_QUICKSTART,
      summary.capabilities.map((c) => c.id)
    )
    expect(ids).toContain(CHROME_GEN)
  })

  it("does not treat Generate then summarize as a separate summarize capability", () => {
    const ids = inferRequiredCapabilityIds(
      "Generate then summarize with Chrome AI",
      summary.capabilities.map((c) => c.id)
    )
    expect(ids).toContain(CHROME_GEN)
    expect(ids).not.toContain("@executioncontrolprotocol/test.summarize")
  })

  it("collectCreateCapabilityFeedback accepts steps without type field", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "w", label: "W" },
      steps: [
        {
          id: "poem",
          uses: CHROME_GEN,
          label: "Generate Poem",
          as: "poem",
        },
      ],
    }
    const feedback = collectCreateCapabilityFeedback(
      "Create a Chrome AI poem workflow",
      summary,
      wf
    )
    expect(feedback).toBeUndefined()
  })

  it("collectCreateCapabilityFeedback flags missing ollama.generate step", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "w", label: "W" },
      steps: [
        {
          type: "step",
          id: "poem",
          label: "Generate Poem",
          uses: CHROME_GEN,
          input: { prompt: "hi" },
          as: "poem",
        },
      ],
    }
    const feedback = collectCreateCapabilityFeedback(
      `chrome then ollama with ${OLLAMA_GEN}`,
      summary,
      wf
    )
    expect(feedback?.length).toBeGreaterThan(0)
  })

  it("does not require summarize capability when request removes summarize step", () => {
    const ids = inferRequiredCapabilityIds(
      `Add a critique step after poem using ${CHROME_GEN} and remove summarize if present.`,
      summary.capabilities.map((c) => c.id)
    )
    expect(ids).toContain(CHROME_GEN)
    expect(ids).not.toContain("@executioncontrolprotocol/test.summarize")
  })

  it("buildPatchOperationHintLines provides workflow context and operation selection", () => {
    const wf = poemSummarizeWorkflow()
    const lines = buildPatchOperationHintLines(
      "Change summarize step label to Short Summary.",
      wf
    )
    expect(lines.some((l) => l.includes('PATCH WORKFLOW must use id "poem-summarize"'))).toBe(true)
    expect(lines.some((l) => l.includes("poem, summarize"))).toBe(true)
    expect(lines.some((l) => l.includes("change a step label or input"))).toBe(true)
    expect(lines.some((l) => l.includes("UPDATE STEP"))).toBe(true)
  })

  it("buildPatchOperationHintLines steers workflow label to UPDATE WORKFLOW", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "poem-summarize", label: "Poem Summarization" },
      steps: [
        {
          type: "step",
          id: "poem",
          uses: CHROME_GEN,
          label: "Generate Poem",
          as: "poem",
        },
      ],
    }
    const lines = buildPatchOperationHintLines("Change workflow label to Updated Chain.", wf)
    expect(lines.some((l) => l.includes("UPDATE WORKFLOW"))).toBe(true)
    expect(lines.some((l) => l.includes("not UPDATE STEP"))).toBe(true)
  })

  it("buildPatchOperationHintLines targets summarize for step label change", () => {
    const lines = buildPatchOperationHintLines(
      "Change summarize step label to Short Summary.",
      poemSummarizeWorkflow()
    )
    expect(lines.some((l) => l.includes("Target step: summarize"))).toBe(true)
    expect(lines.some((l) => l.includes("UPDATE STEP summarize"))).toBe(true)
  })

  it("buildPatchOperationHintLines spells out combined delete and add", () => {
    const lines = buildPatchOperationHintLines(
      `Add critique after poem using ${CHROME_GEN} and remove summarize if present.`,
      poemSummarizeWorkflow(),
      summary.capabilities.map((c) => c.id)
    )
    const text = lines.join("\n")
    expect(text).toContain("DELETE STEP summarize")
    expect(text).toContain(`ADD STEP generate USES ${CHROME_GEN} AFTER poem`)
    expect(text).not.toContain("for the new capability")
    expect(text).toContain("Do not UPDATE STEP summarize")
  })

  it("buildPatchOperationHintLines lists DELETE for every step on remove-all", () => {
    const lines = buildPatchOperationHintLines(
      "Remove all steps from the workflow.",
      poemSummarizeWorkflow()
    )
    const text = lines.join("\n")
    expect(text).toContain("DELETE STEP poem")
    expect(text).toContain("DELETE STEP summarize")
    expect(text).toContain("clears all steps")
  })

  it("collectPatchGoalFeedback flags remaining steps after clear-all", () => {
    const feedback = collectPatchGoalFeedback(
      "Remove all steps from the workflow.",
      poemSummarizeWorkflow(),
      summary,
      poemSummarizeWorkflow()
    )
    const text = (feedback ?? []).flatMap((f) => f.issues.map((i) => i.message)).join("\n")
    expect(text).toMatch(/clears all steps/i)
    expect(text).toContain("poem")
  })

  it("buildRequestCapabilityHintLines patch mode does not inject operation templates", () => {
    const lines = buildRequestCapabilityHintLines(
      `Add a summarize step after poem using ${CHROME_GEN}.`,
      summary,
      { mode: "patch" }
    )
    const text = lines.join("\n")
    expect(text).not.toContain(`ADD STEP summarize USES ${CHROME_GEN}`)
    expect(text).not.toContain("Required: 1 step(s) in order")
  })

  it("collectPatchGoalFeedback flags insert ollama generate on chrome-ai-only workflow", () => {
    const baseline: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "poem-only", label: "Poem" },
      steps: [
        {
          type: "step",
          id: "poem",
          uses: CHROME_GEN,
          label: "Generate Poem",
          as: "poem",
        },
      ],
    }
    const feedback = collectPatchGoalFeedback(
      `Insert a critique step before poem using ${OLLAMA_GEN}.`,
      baseline,
      summary,
      baseline
    )
    expect(feedback?.some((f) => f.issues.some((i) => i.message.includes(OLLAMA_GEN)))).toBe(
      true
    )
  })

  it("collectPatchGoalFeedback flags wrong label capitalization", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "poem-test", label: "Poem" },
      steps: [
        {
          type: "step",
          id: "poem",
          label: "patched poem",
          uses: CHROME_GEN,
          input: { prompt: "hi" },
          as: "poem",
        },
      ],
    }
    const feedback = collectPatchGoalFeedback(
      "Change the poem step label to Patched Poem.",
      wf,
      summary
    )
    expect(
      feedback?.some((f) => f.issues.some((i) => i.message.includes("Patched Poem")))
    ).toBe(true)
  })

  it("buildPatchOperationHintLines suggests MOVE STEP for reorder requests", () => {
    const lines = buildPatchOperationHintLines(
      "Move the poem step to run after summarize.",
      poemSummarizeWorkflow()
    )
    const text = lines.join("\n")
    expect(text).toContain("MOVE STEP poem AFTER summarize")
    expect(text).toContain("Current step order: poem, summarize")
    expect(text).toContain("do not ADD STEP summarize")
    expect(text).not.toContain("UPDATE STEP poem")
  })

  it("infers poem step id from rename label request", () => {
    expect(
      inferPatchTargetStepId("Rename poem label to Draft Poem.", ["poem", "summarize"])
    ).toBe("poem")
  })

  it("collectPatchGoalFeedback flags delete instead of move", () => {
    const baseline = poemSummarizeWorkflow()
    const patched: WorkflowManifest = {
      ...baseline,
      steps: [
        {
          type: "step",
          id: "summarize",
          uses: CHROME_GEN,
          label: "Summarize Poem",
          as: "summary",
        },
      ],
    }
    const feedback = collectPatchGoalFeedback(
      "Move the poem step to run after summarize.",
      patched,
      summary,
      baseline
    )
    expect(
      feedback?.some((f) => f.issues.some((i) => i.message.includes("Do not DELETE STEP poem")))
    ).toBe(true)
  })

  it("collectPatchGoalFeedback flags wrong step order after move request", () => {
    const baseline = poemSummarizeWorkflow()
    const feedback = collectPatchGoalFeedback(
      "Move the poem step to run after summarize.",
      baseline,
      summary,
      baseline
    )
    expect(
      feedback?.some((f) =>
        f.issues.some((i) => i.message.includes("MOVE STEP poem AFTER summarize"))
      )
    ).toBe(true)
  })

  it("inferRequiredStepCount returns 2 for two-step and generate-then-summarize", () => {
    expect(inferRequiredStepCount("Create a two-step workflow")).toBe(2)
    expect(
      inferRequiredStepCount(
        "Generate a poem then summarize it with @executioncontrolprotocol/chrome-ai.generate"
      )
    ).toBe(2)
    expect(inferRequiredStepCount(EMAIL_QUICKSTART)).toBe(2)
    expect(inferRequiredStepCount("Create a 3-step workflow")).toBe(3)
  })

  it("email/haiku/trivia quickstarts infer chrome-ai.generate and correct step counts", () => {
    const caps = summary.capabilities.map((c) => c.id)
    expect(inferRequiredCapabilityIds(EMAIL_QUICKSTART, caps)).toContain(CHROME_GEN)
    expect(inferRequiredStepCount(EMAIL_QUICKSTART)).toBe(2)
    expect(inferRequiredCapabilityIds(HAIKU_QUICKSTART, caps)).toContain(CHROME_GEN)
    expect(inferRequiredStepCount(HAIKU_QUICKSTART)).toBe(2)
    expect(inferRequiredCapabilityIds(TRIVIA_QUICKSTART, caps)).toContain(CHROME_GEN)
    expect(inferRequiredStepCount(TRIVIA_QUICKSTART)).toBe(3)
  })

  it("buildRequestCapabilityHintLines nudges distinct ids for email quick start", () => {
    const lines = buildRequestCapabilityHintLines(EMAIL_QUICKSTART, summary, { mode: "create" })
    const text = lines.join("\n")
    expect(text).toContain("2 STEP lines with distinct step ids")
    expect(text).toContain("do not repeat the capability suffix")
  })

  it("collectCreateCapabilityFeedback allows two chrome-ai steps for same-cap reuse", () => {
    const feedback = collectCreateCapabilityFeedback(EMAIL_QUICKSTART, summary, emailActionWorkflow())
    expect(feedback).toBeUndefined()
  })

  it("collectCreateStepCountFeedback allows two steps for email quick start", async () => {
    const { collectCreateStepCountFeedback } = await import(
      "../../../harnesses/browser-nano/src/_internal/request-capability-hints.js"
    )
    const feedback = collectCreateStepCountFeedback(EMAIL_QUICKSTART, emailActionWorkflow(), [
      CHROME_GEN,
    ])
    expect(feedback).toBeUndefined()
  })

  it("collectCreateStepCountFeedback flags extra steps for single-step request", async () => {
    const { collectCreateStepCountFeedback } = await import(
      "../../../harnesses/browser-nano/src/_internal/request-capability-hints.js"
    )
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "w", label: "W" },
      steps: [
        { type: "step", id: "a", uses: CHROME_GEN, label: "A", as: "a" },
        { type: "step", id: "b", uses: CHROME_GEN, label: "B", as: "b" },
      ],
    }
    const feedback = collectCreateStepCountFeedback(
      "Create a minimal one-step workflow with Chrome AI",
      wf,
      [CHROME_GEN]
    )
    expect(feedback?.[0]?.issues[0]?.message).toContain("exactly one capability step")
  })

  it("collectCreateStepCountFeedback does not require zero steps when no capabilities matched", async () => {
    const { collectCreateStepCountFeedback } = await import(
      "../../../harnesses/browser-nano/src/_internal/request-capability-hints.js"
    )
    const cap = "@executioncontrolprotocol/image-sharp.inspect"
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "resize-image", label: "Resize Image" },
      steps: [
        { type: "step", id: "inspect", uses: cap, label: "Inspect Image", as: "inspect" },
      ],
    }
    const feedback = collectCreateStepCountFeedback("Resize this image", wf, [])
    expect(feedback).toBeUndefined()
  })

  it("buildRequestCapabilityHintLines nudges distinct ids for same-cap reuse", () => {
    const lines = buildRequestCapabilityHintLines(
      `Create a two-step workflow: generate a poem with ${CHROME_GEN}, then summarize with the same capability.`,
      summary,
      { mode: "create" }
    )
    const text = lines.join("\n")
    expect(text).toContain("2 STEP lines with distinct step ids")
    expect(text).toContain("do not repeat the capability suffix")
  })

  it("collectCreateDuplicateStepIdFeedback flags duplicate generate id", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "poem-summarize", label: "Poem" },
      steps: [
        {
          type: "step",
          id: "generate",
          uses: CHROME_GEN,
          label: "Generate Poem",
          as: "poem",
        },
        {
          type: "step",
          id: "generate",
          uses: CHROME_GEN,
          label: "Summarize Poem",
          as: "summary",
        },
      ],
    }
    const feedback = collectCreateDuplicateStepIdFeedback(wf)
    expect(feedback?.length).toBe(1)
    expect(feedback?.[0]?.issues[0]?.message).toContain('Duplicate step id "generate"')
    expect(feedback?.[0]?.issues[0]?.message).toContain("poem and summarize")
  })
})

describe("collectGenerateReturnsTypeFeedback", () => {
  it("flags string RETURNS mapped to a *.generate .as key", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: {
        id: "skip-generate",
        label: "Skip Generate",
        returns: {
          type: "object",
          properties: { response: { type: "string" } },
          required: ["response"],
        },
      },
      steps: [
        {
          id: "generate",
          uses: CHROME_GEN,
          label: "Generate",
          as: "response",
        },
      ],
    }
    const feedback = collectGenerateReturnsTypeFeedback(wf, "eql")
    expect(feedback?.length).toBe(1)
    expect(feedback?.[0]?.issues[0]?.message).toMatch(/object!/)
    expect(feedback?.[0]?.issues[0]?.message).toContain("response")
  })

  it("does not flag object RETURNS on a *.generate .as key", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: {
        id: "ok",
        label: "Ok",
        returns: {
          type: "object",
          properties: { response: { type: "object" } },
          required: ["response"],
        },
      },
      steps: [
        {
          id: "generate",
          uses: CHROME_GEN,
          label: "Generate",
          as: "response",
        },
      ],
    }
    expect(collectGenerateReturnsTypeFeedback(wf)).toBeUndefined()
  })

  it("does not apply generate-specific feedback for non-generate string returns", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: {
        id: "notify-str",
        label: "Notify",
        returns: {
          type: "object",
          properties: { ok: { type: "string" } },
          required: ["ok"],
        },
      },
      steps: [
        {
          id: "notify",
          uses: "@executioncontrolprotocol/test.notify",
          label: "Notify",
          as: "ok",
        },
      ],
    }
    expect(collectGenerateReturnsTypeFeedback(wf)).toBeUndefined()
  })

  it("collectCreateWorkflowIoFeedback surfaces generate returns type errors without I/O keywords", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: {
        id: "skip-generate",
        label: "Skip Generate",
        returns: {
          type: "object",
          properties: { response: { type: "string" } },
          required: ["response"],
        },
      },
      steps: [
        {
          id: "generate",
          uses: CHROME_GEN,
          label: "Generate",
          as: "response",
        },
      ],
    }
    const feedback = collectCreateWorkflowIoFeedback("Create a chrome generate workflow", wf)
    expect(feedback?.some((f) => f.issues.some((i) => i.message.includes("object!")))).toBe(true)
  })
})
