import { describe, expect, it, vi, afterEach } from "vitest"
import {
  anthropicExtension,
  registerAnthropicExtension,
  resolveAnthropicApiKey,
  resolveAnthropicSamplingOptions,
  ANTHROPIC_DEFAULT_MODEL,
} from "../src/index.js"

describe("@executioncontrolprotocol/anthropic", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("exposes generate and evaluate capabilities", () => {
    const ids = anthropicExtension.capabilities.map((c) => c.id)
    expect(ids).toEqual([
      "@executioncontrolprotocol/anthropic.generate",
      "@executioncontrolprotocol/anthropic.evaluate",
    ])
  })

  it("declares local execution on capabilities", () => {
    for (const cap of anthropicExtension.capabilities) {
      expect(cap.execution).toBe("local")
    }
  })

  it("resolveAnthropicApiKey prefers config then env", () => {
    expect(resolveAnthropicApiKey({ apiKey: "from-config" })).toBe("from-config")
    vi.stubEnv("ANTHROPIC_API_KEY", "from-env")
    expect(resolveAnthropicApiKey({})).toBe("from-env")
  })

  it("resolveAnthropicSamplingOptions prefers temperature over top_p", () => {
    expect(resolveAnthropicSamplingOptions({ temperature: 0.1, top_p: 0.9 })).toEqual({
      max_tokens: 4096,
      temperature: 0.1,
    })
    expect(resolveAnthropicSamplingOptions({ top_p: 0.9 })).toEqual({
      max_tokens: 4096,
      top_p: 0.9,
    })
  })

  it("generate returns text from Messages API", async () => {
    await registerAnthropicExtension()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "anthropic reply" }],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const cap = anthropicExtension.capabilities.find(
      (c) => c.id === "@executioncontrolprotocol/anthropic.generate"
    )
    const result = await cap!.handler!(
      { prompt: "hello", system: "be brief", context: { k: 1 } },
      {
        extensionConfig: { apiKey: "test-key", defaultModel: ANTHROPIC_DEFAULT_MODEL },
        usage: { increment: vi.fn() },
      } as never
    )
    expect(result).toEqual({ text: "anthropic reply" })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      system: string
      messages: Array<{ content: unknown }>
      model: string
    }
    expect(body.model).toBe(ANTHROPIC_DEFAULT_MODEL)
    expect(body.system).toContain("be brief")
    expect(body.system).toContain('{"k":1}')
    expect(body.messages[0]?.content).toEqual([{ type: "text", text: "hello" }])
    expect(fetchMock.mock.calls[0][1].headers["anthropic-dangerous-direct-browser-access"]).toBe(
      "true"
    )
  })

  it("generate maps image buffer files to Messages image blocks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "saw image" }] }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const cap = anthropicExtension.capabilities.find(
      (c) => c.id === "@executioncontrolprotocol/anthropic.generate"
    )
    const pngBytes = new Uint8Array([137, 80, 78, 71])
    const data = Buffer.from(pngBytes).toString("base64")
    await cap!.handler!(
      {
        prompt: "describe",
        files: [{ kind: "buffer", data, mediaType: "image/png" }],
      },
      {
        extensionConfig: { apiKey: "test-key" },
        usage: { increment: vi.fn() },
      } as never
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ content: Array<{ type: string }> }>
    }
    expect(body.messages[0]?.content[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/png", data },
    })
    expect(body.messages[0]?.content[1]).toEqual({ type: "text", text: "describe" })
  })

  it("generate maps pdf buffer files to document blocks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "saw pdf" }] }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const cap = anthropicExtension.capabilities.find(
      (c) => c.id === "@executioncontrolprotocol/anthropic.generate"
    )
    const data = Buffer.from("%PDF-1.4").toString("base64")
    await cap!.handler!(
      {
        prompt: "summarize",
        files: [{ kind: "buffer", data, mediaType: "application/pdf" }],
      },
      {
        extensionConfig: { apiKey: "test-key" },
        usage: { increment: vi.fn() },
      } as never
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ content: Array<{ type: string }> }>
    }
    expect(body.messages[0]?.content[0]).toMatchObject({
      type: "document",
      source: { type: "base64", media_type: "application/pdf" },
    })
  })

  it("generate uses URL source for url image refs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "ok" }] }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const cap = anthropicExtension.capabilities.find(
      (c) => c.id === "@executioncontrolprotocol/anthropic.generate"
    )
    await cap!.handler!(
      {
        prompt: "what is this",
        files: [{ kind: "url", url: "https://example.com/a.png", mediaType: "image/png" }],
      },
      {
        extensionConfig: { apiKey: "test-key" },
        usage: { increment: vi.fn() },
      } as never
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ content: Array<{ type: string; source?: { type: string; url?: string } }> }>
    }
    expect(body.messages[0]?.content[0]).toEqual({
      type: "image",
      source: { type: "url", url: "https://example.com/a.png" },
    })
  })

  it("generate rejects unsupported media types", async () => {
    const cap = anthropicExtension.capabilities.find(
      (c) => c.id === "@executioncontrolprotocol/anthropic.generate"
    )
    await expect(
      cap!.handler!(
        {
          prompt: "x",
          files: [{ kind: "buffer", data: "YQ==", mediaType: "image/svg+xml" }],
        },
        {
          extensionConfig: { apiKey: "test-key" },
          usage: { increment: vi.fn() },
        } as never
      )
    ).rejects.toThrow(/Unsupported Anthropic generate file media type/)
  })

  it("generate fails without api key", async () => {
    const cap = anthropicExtension.capabilities.find(
      (c) => c.id === "@executioncontrolprotocol/anthropic.generate"
    )
    await expect(
      cap!.handler!({ prompt: "hello" }, { extensionConfig: {}, usage: { increment: vi.fn() } } as never)
    ).rejects.toThrow("Anthropic API key required")
  })

  it("evaluate parses JSON approval", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: '{"approved":false,"feedback":"no"}' }],
        }),
      })
    )
    const cap = anthropicExtension.capabilities.find(
      (c) => c.id === "@executioncontrolprotocol/anthropic.evaluate"
    )
    const result = await cap!.handler!(
      { artifact: { answer: "x" }, goal: "check" },
      {
        extensionConfig: { apiKey: "test-key" },
        usage: { increment: vi.fn() },
      } as never
    )
    expect(result).toEqual({ approved: false, feedback: "no" })
  })
})
