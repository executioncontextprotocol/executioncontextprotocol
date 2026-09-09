import { describe, expect, it } from "vitest"
import { tryBuildRunContextReply } from "../../src/harness/authoring/safe-reply.js"
import type { HarnessRunContext } from "@executioncontrolprotocol/types"

const failedEchoContext: HarnessRunContext = {
  run: {
    schema: "@executioncontrolprotocol.run.result",
    version: "1.0",
    run: { id: "run-failed-echo", status: "failed" },
    history: {
      echo: {
        status: "failed",
        output: { error: "Echo step rejected input: value must be non-empty" },
        attempts: 1,
      },
    },
  },
  workflow: {
    schema: "@executioncontrolprotocol.workflow",
    version: "1.0",
    workflow: { id: "echo-test", label: "Echo test" },
    steps: [],
  },
}

describe("tryBuildRunContextReply", () => {
  it("answers run status from context", () => {
    const reply = tryBuildRunContextReply("What is the run status?", failedEchoContext)
    expect(reply?.answer.toLowerCase()).toContain("failed")
  })

  it("answers whether workflow is still running", () => {
    const runningContext: HarnessRunContext = {
      run: {
        schema: "@executioncontrolprotocol.run.result",
        version: "1.0",
        run: { id: "run-started", status: "started" },
        history: {},
      },
    }
    const reply = tryBuildRunContextReply("Is my workflow still running?", runningContext)
    expect(reply?.answer.toLowerCase()).toContain("run")
    expect(reply?.answer.toLowerCase()).toContain("started")
  })

  it("answers echo failure errors from context", () => {
    const reply = tryBuildRunContextReply("Why did step echo fail?", failedEchoContext)
    expect(reply?.answer.toLowerCase()).toContain("echo")
    expect(reply?.answer.toLowerCase()).toContain("error")
  })

  it("explains failure politely from run context", () => {
    const reply = tryBuildRunContextReply("Explain the failure politely.", failedEchoContext)
    expect(reply?.answer.toLowerCase()).toContain("error")
    expect(reply?.answer.toLowerCase()).toContain("echo")
  })
})

describe("tryBuildFaqReply", () => {
  it("answers patching FAQ without patch EQL syntax", async () => {
    const { tryBuildFaqReply } = await import("../../src/harness/authoring/safe-reply.js")
    const reply = tryBuildFaqReply("How does workflow patching work?", {
      schema: "@executioncontrolprotocol.intent",
      version: "1.0",
      intent: "faq",
      topic: "patching",
    })
    expect(reply?.answer.toLowerCase()).toContain("patch")
    expect(reply?.answer).not.toMatch(/\bPATCH WORKFLOW\b|\bUPDATE STEP\b/)
  })
})

describe("tryBuildChangeSummaryReply", () => {
  it("always sets offer-run", async () => {
    const { tryBuildChangeSummaryReply } = await import("../../src/harness/authoring/safe-reply.js")
    const authored = {
      schema: "@executioncontrolprotocol.workflow" as const,
      version: "1.0",
      workflow: { id: "w", label: "W" },
      steps: [
        {
          type: "step" as const,
          id: "echo",
          uses: "@executioncontrolprotocol/test.echo",
          as: "echo",
        },
      ],
    }
    const reply = tryBuildChangeSummaryReply(undefined, authored)
    expect(reply.suggestedAction).toBe("offer-run")
  })
})

describe("tryBuildEnvironmentReply", () => {
  it("lists ECP extensions and step capabilities", async () => {
    const { tryBuildEnvironmentReply } = await import("../../src/harness/authoring/safe-reply.js")
    const reply = tryBuildEnvironmentReply("What extensions are available in this environment?", {
      extensions: [
        { id: "@executioncontrolprotocol/ollama", capabilities: [] },
        { id: "@executioncontrolprotocol/test", capabilities: ["@executioncontrolprotocol/test.echo"] },
      ],
      capabilities: [
        {
          id: "@executioncontrolprotocol/test.echo",
          extension: "@executioncontrolprotocol/test",
          inputs: ["value"],
          outputs: [],
        },
      ],
    })
    expect(reply?.answer.toLowerCase()).toContain("ecp")
    expect(reply?.answer).toContain("@executioncontrolprotocol/test.echo")
  })
})
