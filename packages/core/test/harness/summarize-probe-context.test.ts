import { describe, expect, it } from "vitest"
import {
  buildPhotoshopLayersProbeContext,
  messageSelectsProbeOptions,
  probeOptionsFromPhotoshopManifest,
  summarizeProbeContext,
} from "../../src/harness/authoring/summarize-probe-context.js"

describe("probeOptionsFromPhotoshopManifest", () => {
  it("flattens nested layer trees into probe options", () => {
    const options = probeOptionsFromPhotoshopManifest({
      layers: [
        { id: "g1", name: "Group", children: [{ id: "l1", name: "Headline" }] },
        { id: "l2", name: "Logo" },
      ],
    })
    expect(options.map((o) => o.label)).toEqual(["Group", "Headline", "Logo"])
    expect(options.find((o) => o.id === "l1")?.path).toContain("layers")
  })

  it("returns empty for missing layers", () => {
    expect(probeOptionsFromPhotoshopManifest({})).toEqual([])
    expect(probeOptionsFromPhotoshopManifest(null)).toEqual([])
  })

  it("supports id-only and name-only nodes", () => {
    const options = probeOptionsFromPhotoshopManifest({
      layers: [{ id: 42 }, { name: "OnlyName" }],
    })
    expect(options[0]?.id).toBe("42")
    expect(options[1]?.label).toBe("OnlyName")
  })
})

describe("summarizeProbeContext", () => {
  it("lists option labels and ids", () => {
    const lines = summarizeProbeContext({
      probeId: "p1",
      domain: "photoshop-layers",
      summary: "Found 2 layers",
      options: [
        { id: "a", label: "Headline" },
        { id: "b", label: "Logo" },
      ],
    })
    expect(lines.join("\n")).toContain("Headline (id=a)")
    expect(lines.join("\n")).toContain("Logo (id=b)")
  })

  it("handles empty options and truncates large lists", () => {
    expect(
      summarizeProbeContext({
        probeId: "p1",
        domain: "x",
        summary: "none",
        options: [],
      }).join("\n")
    ).toContain("(none)")

    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `id-${i}`,
      label: `Layer ${i}`,
    }))
    const joined = summarizeProbeContext({
      probeId: "p1",
      domain: "x",
      summary: "many",
      options: many,
    }).join("\n")
    expect(joined).toContain("and 6 more")
  })
})

describe("buildPhotoshopLayersProbeContext / messageSelectsProbeOptions", () => {
  it("builds domain context and detects selections", () => {
    const probe = buildPhotoshopLayersProbeContext({
      probeId: "probe-1",
      manifest: { layers: [{ id: "h1", name: "Headline" }, { id: "l1", name: "Logo" }] },
      stepAs: "manifest",
    })
    expect(probe.domain).toBe("photoshop-layers")
    expect(probe.options).toHaveLength(2)
    expect(messageSelectsProbeOptions("Use Headline and Logo", probe)).toBe(true)
    expect(messageSelectsProbeOptions("make it better", probe)).toBe(false)
  })
})
