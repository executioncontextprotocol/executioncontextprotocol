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

const summary: CompactEnvironmentSummary = {
  extensions: [{ id: "@executioncontrolprotocol/test", capabilities: ["@executioncontrolprotocol/test.summarize", "@executioncontrolprotocol/test.notify"] }],
  capabilities: [
    { id: "@executioncontrolprotocol/test.echo", extension: "@executioncontrolprotocol/test", inputs: ["value"], outputs: ["text"] },
    { id: "@executioncontrolprotocol/test.summarize", extension: "@executioncontrolprotocol/test", inputs: ["text"], outputs: [] },
    { id: "@executioncontrolprotocol/test.notify", extension: "@executioncontrolprotocol/test", inputs: ["payload"], outputs: [] },
    { id: "@executioncontrolprotocol/test.validate", extension: "@executioncontrolprotocol/test", inputs: ["payload"], outputs: [] },
    { id: "@executioncontrolprotocol/test.translate", extension: "@executioncontrolprotocol/test", inputs: ["text"], outputs: [] },
    { id: "@executioncontrolprotocol/chrome-ai.generate", extension: "@executioncontrolprotocol/chrome-ai", inputs: ["prompt"], outputs: ["text"] },
  ],
}

describe("request-capability-hints", () => {
  it("infers echo and summarize from natural language", () => {
    const ids = inferRequiredCapabilityIds(
      "Create a workflow with echo (@executioncontrolprotocol/test.echo) then summarize (@executioncontrolprotocol/test.summarize)",
      summary.capabilities.map((c) => c.id)
    )
    expect(ids).toContain("@executioncontrolprotocol/test.echo")
    expect(ids).toContain("@executioncontrolprotocol/test.summarize")
  })

  it("infers validate when capability id appears in request", () => {
    const ids = inferRequiredCapabilityIds(
      "Build a workflow: first @executioncontrolprotocol/test.validate then @executioncontrolprotocol/test.echo.",
      summary.capabilities.map((c) => c.id)
    )
    expect(ids).toContain("@executioncontrolprotocol/test.validate")
    expect(ids).toContain("@executioncontrolprotocol/test.echo")
  })

  it("does not treat Validate then echo as validate capability", () => {
    const ids = inferRequiredCapabilityIds(
      "Validate then echo with hello input",
      summary.capabilities.map((c) => c.id)
    )
    expect(ids).toContain("@executioncontrolprotocol/test.echo")
    expect(ids).not.toContain("@executioncontrolprotocol/test.validate")
  })

  it("collectCreateCapabilityFeedback accepts steps without type field", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "w", label: "W" },
      steps: [
        {
          id: "echo",
          uses: "@executioncontrolprotocol/test.echo",
          label: "Echo",
          as: "echo",
        },
      ],
    }
    const feedback = collectCreateCapabilityFeedback(
      "Create an echo workflow",
      summary,
      wf
    )
    expect(feedback).toBeUndefined()
  })

  it("collectCreateCapabilityFeedback flags missing summarize step", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "w", label: "W" },
      steps: [
        {
          type: "step",
          id: "echo",
          label: "Echo",
          uses: "@executioncontrolprotocol/test.echo",
          input: { value: "hi" },
          as: "echo",
        },
      ],
    }
    const feedback = collectCreateCapabilityFeedback(
      "echo then summarize",
      summary,
      wf
    )
    expect(feedback?.length).toBeGreaterThan(0)
  })

  it("does not require summarize when request removes summarize step", () => {
    const ids = inferRequiredCapabilityIds(
      "Add translate after echo and remove summarize if present.",
      summary.capabilities.map((c) => c.id)
    )
    expect(ids).toContain("@executioncontrolprotocol/test.translate")
    expect(ids).not.toContain("@executioncontrolprotocol/test.summarize")
  })

  it("buildPatchOperationHintLines provides workflow context and operation selection", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "two-step", label: "Two" },
      steps: [
        {
          type: "step",
          id: "echo",
          uses: "@executioncontrolprotocol/test.echo",
          label: "Echo",
          as: "echo",
        },
        {
          type: "step",
          id: "summarize",
          uses: "@executioncontrolprotocol/test.summarize",
          label: "Summarize",
          as: "summary",
        },
      ],
    }
    const lines = buildPatchOperationHintLines(
      "Change summarize step label to Short Summary.",
      wf
    )
    expect(lines.some((l) => l.includes('PATCH WORKFLOW must use id "two-step"'))).toBe(true)
    expect(lines.some((l) => l.includes("echo, summarize"))).toBe(true)
    expect(lines.some((l) => l.includes("change a step label or input"))).toBe(true)
    expect(lines.some((l) => l.includes("UPDATE STEP"))).toBe(true)
  })

  it("buildPatchOperationHintLines steers workflow label to UPDATE WORKFLOW", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "two-step-chain", label: "Two step chain" },
      steps: [
        {
          type: "step",
          id: "echo",
          uses: "@executioncontrolprotocol/test.echo",
          label: "Echo",
          as: "echo",
        },
      ],
    }
    const lines = buildPatchOperationHintLines("Change workflow label to Updated Chain.", wf)
    expect(lines.some((l) => l.includes("UPDATE WORKFLOW"))).toBe(true)
    expect(lines.some((l) => l.includes("not UPDATE STEP"))).toBe(true)
  })

  it("buildPatchOperationHintLines targets summarize for step label change", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "two-step-chain", label: "Two" },
      steps: [
        {
          type: "step",
          id: "echo",
          uses: "@executioncontrolprotocol/test.echo",
          label: "Echo",
          as: "echo",
        },
        {
          type: "step",
          id: "summarize",
          uses: "@executioncontrolprotocol/test.summarize",
          label: "Summarize",
          as: "summary",
        },
      ],
    }
    const lines = buildPatchOperationHintLines(
      "Change summarize step label to Short Summary.",
      wf
    )
    expect(lines.some((l) => l.includes("Target step: summarize"))).toBe(true)
    expect(lines.some((l) => l.includes("UPDATE STEP summarize"))).toBe(true)
  })

  it("buildPatchOperationHintLines spells out combined delete and add", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "two-step-chain", label: "Two" },
      steps: [
        {
          type: "step",
          id: "echo",
          uses: "@executioncontrolprotocol/test.echo",
          label: "Echo",
          as: "echo",
        },
        {
          type: "step",
          id: "summarize",
          uses: "@executioncontrolprotocol/test.summarize",
          label: "Summarize",
          as: "summary",
        },
      ],
    }
    const lines = buildPatchOperationHintLines(
      "Add translate after echo and remove summarize if present.",
      wf,
      summary.capabilities.map((c) => c.id)
    )
    const text = lines.join("\n")
    expect(text).toContain("DELETE STEP summarize")
    expect(text).toContain("ADD STEP translate USES @executioncontrolprotocol/test.translate AFTER echo")
    expect(text).not.toContain("for the new capability")
    expect(text).toContain("Do not UPDATE STEP summarize")
  })

  it("buildRequestCapabilityHintLines patch mode does not inject operation templates", () => {
    const lines = buildRequestCapabilityHintLines(
      "Add a summarize step after echo using @executioncontrolprotocol/test.summarize.",
      summary,
      { mode: "patch" }
    )
    const text = lines.join("\n")
    expect(text).not.toContain("ADD STEP summarize USES @executioncontrolprotocol/test.summarize")
    expect(text).not.toContain("Required: 1 step(s) in order")
  })

  it("collectPatchGoalFeedback flags insert validate on echo-only workflow", () => {
    const baseline: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "echo-only", label: "Echo" },
      steps: [
        {
          type: "step",
          id: "echo",
          uses: "@executioncontrolprotocol/test.echo",
          label: "Echo",
          as: "echo",
        },
      ],
    }
    const feedback = collectPatchGoalFeedback(
      "Insert a validate step before echo using @executioncontrolprotocol/test.validate.",
      baseline,
      summary,
      baseline
    )
    expect(
      feedback?.some((f) => f.issues.some((i) => i.message.includes("@executioncontrolprotocol/test.validate")))
    ).toBe(true)
  })

  it("collectPatchGoalFeedback flags wrong label capitalization", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "echo-test", label: "Echo" },
      steps: [
        {
          type: "step",
          id: "echo",
          label: "patched echo",
          uses: "@executioncontrolprotocol/test.echo",
          input: { value: "hi" },
          as: "echo",
        },
      ],
    }
    const feedback = collectPatchGoalFeedback(
      "Change the echo step label to Patched Echo.",
      wf,
      summary
    )
    expect(
      feedback?.some((f) => f.issues.some((i) => i.message.includes("Patched Echo")))
    ).toBe(true)
  })

  it("buildPatchOperationHintLines suggests MOVE STEP for reorder requests", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "echo-validate", label: "Echo validate reorder" },
      steps: [
        { type: "step", id: "echo", uses: "@executioncontrolprotocol/test.echo", label: "Echo", as: "echo" },
        { type: "step", id: "validate", uses: "@executioncontrolprotocol/test.validate", label: "Validate", as: "validated" },
      ],
    }
    const lines = buildPatchOperationHintLines(
      "Move the echo step to run after validate.",
      wf
    )
    const text = lines.join("\n")
    expect(text).toContain("MOVE STEP echo AFTER validate")
    expect(text).toContain("Current step order: echo, validate")
    expect(text).toContain("do not ADD STEP validate")
    expect(text).not.toContain("UPDATE STEP echo")
  })

  it("infers echo step id from rename label request", () => {
    expect(
      inferPatchTargetStepId("Rename echo label to Translated Output.", ["echo", "summarize"])
    ).toBe("echo")
  })

  it("collectPatchGoalFeedback flags delete instead of move", () => {
    const baseline: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "echo-validate", label: "Echo validate reorder" },
      steps: [
        { type: "step", id: "echo", uses: "@executioncontrolprotocol/test.echo", label: "Echo", as: "echo" },
        { type: "step", id: "validate", uses: "@executioncontrolprotocol/test.validate", label: "Validate", as: "validated" },
      ],
    }
    const patched: WorkflowManifest = {
      ...baseline,
      steps: [
        { type: "step", id: "validate", uses: "@executioncontrolprotocol/test.validate", label: "Validate", as: "validated" },
      ],
    }
    const feedback = collectPatchGoalFeedback(
      "Move the echo step to run after validate.",
      patched,
      summary,
      baseline
    )
    expect(
      feedback?.some((f) => f.issues.some((i) => i.message.includes("Do not DELETE STEP echo")))
    ).toBe(true)
  })

  it("collectPatchGoalFeedback flags wrong step order after move request", () => {
    const baseline: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "echo-validate", label: "Echo validate reorder" },
      steps: [
        { type: "step", id: "echo", uses: "@executioncontrolprotocol/test.echo", label: "Echo", as: "echo" },
        { type: "step", id: "validate", uses: "@executioncontrolprotocol/test.validate", label: "Validate", as: "validated" },
      ],
    }
    const feedback = collectPatchGoalFeedback(
      "Move the echo step to run after validate.",
      baseline,
      summary,
      baseline
    )
    expect(
      feedback?.some((f) => f.issues.some((i) => i.message.includes("MOVE STEP echo AFTER validate")))
    ).toBe(true)
  })

  it("inferRequiredStepCount returns 2 for two-step and generate-then-summarize", () => {
    expect(inferRequiredStepCount("Create a two-step workflow")).toBe(2)
    expect(
      inferRequiredStepCount(
        "Generate a poem then summarize it with @executioncontrolprotocol/chrome-ai.generate"
      )
    ).toBe(2)
    expect(
      inferRequiredStepCount(
        "Build a workflow that uses Chrome AI to generate a short email, then extract key action items from it in a second step."
      )
    ).toBe(2)
    expect(inferRequiredStepCount("Create a 3-step workflow")).toBe(3)
  })

  it("infers chrome-ai.generate from Chrome AI natural language", () => {
    const ids = inferRequiredCapabilityIds(
      "Build a workflow that uses Chrome AI to generate a short email, then extract key action items from it in a second step.",
      summary.capabilities.map((c) => c.id)
    )
    expect(ids).toContain("@executioncontrolprotocol/chrome-ai.generate")
  })

  it("buildRequestCapabilityHintLines nudges distinct ids for email quick start", () => {
    const lines = buildRequestCapabilityHintLines(
      "Build a workflow that uses Chrome AI to generate a short email, then extract key action items from it in a second step.",
      summary,
      { mode: "create" }
    )
    const text = lines.join("\n")
    expect(text).toContain("2 STEP lines with distinct step ids")
    expect(text).toContain("do not repeat the capability suffix")
  })

  it("collectCreateCapabilityFeedback allows two chrome-ai steps for same-cap reuse", () => {
    const cap = "@executioncontrolprotocol/chrome-ai.generate"
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "email-action", label: "Email Action" },
      steps: [
        { type: "step", id: "email", uses: cap, label: "Generate Email", as: "email" },
        { type: "step", id: "actions", uses: cap, label: "Extract Action Items", as: "actions" },
      ],
    }
    const feedback = collectCreateCapabilityFeedback(
      "Build a workflow that uses Chrome AI to generate a short email, then extract key action items from it in a second step.",
      summary,
      wf
    )
    expect(feedback).toBeUndefined()
  })

  it("collectCreateStepCountFeedback allows two steps for email quick start", async () => {
    const { collectCreateStepCountFeedback } = await import(
      "../../../harnesses/browser-nano/src/_internal/request-capability-hints.js"
    )
    const cap = "@executioncontrolprotocol/chrome-ai.generate"
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "email-action", label: "Email Action" },
      steps: [
        { type: "step", id: "email", uses: cap, label: "Generate Email", as: "email" },
        { type: "step", id: "actions", uses: cap, label: "Extract Action Items", as: "actions" },
      ],
    }
    const request =
      "Build a workflow that uses Chrome AI to generate a short email, then extract key action items from it in a second step."
    const feedback = collectCreateStepCountFeedback(request, wf, [cap])
    expect(feedback).toBeUndefined()
  })

  it("collectCreateStepCountFeedback flags extra steps for single-step request", async () => {
    const { collectCreateStepCountFeedback } = await import(
      "../../../harnesses/browser-nano/src/_internal/request-capability-hints.js"
    )
    const cap = "@executioncontrolprotocol/chrome-ai.generate"
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: { id: "w", label: "W" },
      steps: [
        { type: "step", id: "a", uses: cap, label: "A", as: "a" },
        { type: "step", id: "b", uses: cap, label: "B", as: "b" },
      ],
    }
    const feedback = collectCreateStepCountFeedback(
      "Create a minimal one-step workflow with Chrome AI",
      wf,
      [cap]
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
      "Create a two-step workflow: generate a poem with @executioncontrolprotocol/chrome-ai.generate, then summarize with the same capability.",
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
          uses: "@executioncontrolprotocol/chrome-ai.generate",
          label: "Generate Poem",
          as: "poem",
        },
        {
          type: "step",
          id: "generate",
          uses: "@executioncontrolprotocol/chrome-ai.generate",
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
        id: "skip-echo",
        label: "Skip Echo",
        returns: {
          type: "object",
          properties: { response: { type: "string" } },
          required: ["response"],
        },
      },
      steps: [
        {
          id: "generate",
          uses: "@executioncontrolprotocol/chrome-ai.generate",
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
          uses: "@executioncontrolprotocol/chrome-ai.generate",
          label: "Generate",
          as: "response",
        },
      ],
    }
    expect(collectGenerateReturnsTypeFeedback(wf)).toBeUndefined()
  })

  it("does not apply generate-specific feedback for echo string returns", () => {
    const wf: WorkflowManifest = {
      schema: "@executioncontrolprotocol.workflow",
      version: "1.0.0",
      workflow: {
        id: "echo-str",
        label: "Echo",
        returns: {
          type: "object",
          properties: { echo: { type: "string" } },
          required: ["echo"],
        },
      },
      steps: [
        {
          id: "echo",
          uses: "@executioncontrolprotocol/test.echo",
          label: "Echo",
          as: "echo",
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
        id: "skip-echo",
        label: "Skip Echo",
        returns: {
          type: "object",
          properties: { response: { type: "string" } },
          required: ["response"],
        },
      },
      steps: [
        {
          id: "generate",
          uses: "@executioncontrolprotocol/chrome-ai.generate",
          label: "Generate",
          as: "response",
        },
      ],
    }
    const feedback = collectCreateWorkflowIoFeedback("Create a chrome generate workflow", wf)
    expect(feedback?.some((f) => f.issues.some((i) => i.message.includes("object!")))).toBe(true)
  })
})
