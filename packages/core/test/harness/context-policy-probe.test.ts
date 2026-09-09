import { describe, expect, it, vi } from "vitest"
import { buildContextBundle } from "../../src/harness/authoring/context-policy.js"
import type { Ecp } from "../../src/environment/ecp.js"

function fakeEcp(): Ecp {
  return {
    describe: vi.fn(async () => ({
      schema: "@executioncontrolprotocol.environment.descriptor",
      version: "1.0",
      environment: { id: "test" },
      extensions: [],
      capabilities: [],
    })),
  } as unknown as Ecp
}

describe("buildContextBundle probeContext", () => {
  it("includes probe context for clarify and authoring patch", async () => {
    const probeContext = {
      probeId: "p1",
      domain: "photoshop-layers",
      summary: "Found layers",
      options: [{ id: "h1", label: "Headline" }],
    }
    const clarify = await buildContextBundle(fakeEcp(), {
      phase: "contextualized",
      message: "Use Headline",
      intent: "workflow-clarify",
      probeContext,
      includeEnvironmentDescriptor: false,
    })
    expect(clarify.lines.join("\n")).toContain("Probe context:")
    expect(clarify.lines.join("\n")).toContain("Headline (id=h1)")

    const patch = await buildContextBundle(fakeEcp(), {
      phase: "contextualized",
      message: "complete composite",
      intent: "workflow-patch",
      probeContext,
      includeEnvironmentDescriptor: false,
    })
    expect(patch.lines.join("\n")).toContain("Probe context:")
  })

  it("omits probe context on create without clarify intent", async () => {
    const bundle = await buildContextBundle(fakeEcp(), {
      phase: "contextualized",
      message: "Create an echo workflow",
      intent: "workflow-create",
      probeContext: {
        probeId: "p1",
        domain: "photoshop-layers",
        summary: "Found layers",
        options: [{ id: "h1", label: "Headline" }],
      },
      includeEnvironmentDescriptor: false,
    })
    expect(bundle.lines.join("\n")).not.toContain("Probe context:")
  })
})
