import { describe, expect, it } from "vitest"
import { globalRegistry } from "@executioncontrolprotocol/core"
import { registerAllExtensions, BUNDLED_EXTENSION_IDS } from "../src/index.js"

describe("@executioncontrolprotocol/extensions registerAllExtensions", () => {
  it("registers every bundled extension id", async () => {
    await registerAllExtensions()
    for (const id of BUNDLED_EXTENSION_IDS) {
      expect(globalRegistry.getExtension(id), `expected ${id} registered`).toBeDefined()
    }
  })

  it("includes the harness format extensions that encode workflows", () => {
    expect(BUNDLED_EXTENSION_IDS).toContain("@executioncontrolprotocol/format-eql")
    expect(BUNDLED_EXTENSION_IDS).toContain("@executioncontrolprotocol/format-mermaid")
    expect(BUNDLED_EXTENSION_IDS).toContain("@executioncontrolprotocol/format-reactflow")
    expect(BUNDLED_EXTENSION_IDS).toContain("@executioncontrolprotocol/format-toon")
  })

  it("does not bundle host-specific or credentialed providers", () => {
    expect(BUNDLED_EXTENSION_IDS).not.toContain("@executioncontrolprotocol/chrome-ai")
    expect(BUNDLED_EXTENSION_IDS).not.toContain("@executioncontrolprotocol/anthropic")
  })
})
