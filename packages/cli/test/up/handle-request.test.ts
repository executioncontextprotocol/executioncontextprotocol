import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import type { IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { createUpRequestHandler } from "../../src/lib/up/handle-request.js"

vi.mock("@executioncontrolprotocol/extension-ollama", () => ({
  listOllamaModels: vi.fn(),
}))

import { listOllamaModels } from "@executioncontrolprotocol/extension-ollama"

function createRes(): {
  res: ServerResponse
  statusCode: number
  body: string
  headers: Record<string, string>
} {
  let statusCode = 200
  let body = ""
  const headers: Record<string, string> = {}
  const res = {
    headersSent: false,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name.toLowerCase()] = String(value)
      return this
    },
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) headers[k.toLowerCase()] = v
      }
      return this
    },
    end(chunk?: string) {
      if (chunk) body = chunk
      return this
    },
  } as unknown as ServerResponse
  return {
    res,
    get statusCode() {
      return statusCode
    },
    get body() {
      return body
    },
    headers,
  }
}

function createReq(
  method: string,
  url: string,
  headers: Record<string, string>,
  body = ""
): IncomingMessage {
  const stream = Readable.from([body]) as IncomingMessage
  stream.method = method
  stream.url = url
  stream.headers = headers
  return stream
}

describe("createUpRequestHandler", () => {
  const ecp = {
    invoke: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("answers OPTIONS with PNA when requested", async () => {
    const handler = createUpRequestHandler({
      ecp: ecp as never,
      allowOrigins: new Set(["http://localhost:5173"]),
      token: "secret",
      ollamaUrl: "http://127.0.0.1:11434",
    })
    const out = createRes()
    await handler(
      createReq("OPTIONS", "/v1/invoke", {
        origin: "http://localhost:5173",
        "access-control-request-private-network": "true",
      }),
      out.res
    )
    expect(out.statusCode).toBe(204)
    expect(out.headers["access-control-allow-private-network"]).toBe("true")
  })

  it("reports ollamaReachable on /health", async () => {
    vi.mocked(listOllamaModels).mockResolvedValue(["qwen2.5-coder:1.5b"])
    const handler = createUpRequestHandler({
      ecp: ecp as never,
      allowOrigins: new Set(),
      token: "secret",
      ollamaUrl: "http://127.0.0.1:11434",
    })
    const out = createRes()
    await handler(createReq("GET", "/health", {}), out.res)
    expect(out.statusCode).toBe(200)
    expect(JSON.parse(out.body)).toMatchObject({ ok: true, ollamaReachable: true })
  })

  it("rejects /v1/invoke without token", async () => {
    const handler = createUpRequestHandler({
      ecp: ecp as never,
      allowOrigins: new Set(),
      token: "secret",
      ollamaUrl: "http://127.0.0.1:11434",
    })
    const out = createRes()
    await handler(
      createReq("POST", "/v1/invoke", { "content-type": "application/json" }, "{}"),
      out.res
    )
    expect(out.statusCode).toBe(401)
  })

  it("rejects /v1/artifacts without token", async () => {
    const handler = createUpRequestHandler({
      ecp: ecp as never,
      allowOrigins: new Set(),
      token: "secret",
      ollamaUrl: "http://127.0.0.1:11434",
    })
    const out = createRes()
    await handler(
      createReq("GET", "/v1/artifacts?uri=" + encodeURIComponent("ecp://artifacts/x"), {}),
      out.res
    )
    expect(out.statusCode).toBe(401)
  })

  it("allows /v1/artifacts with query token", async () => {
    const get = vi.fn().mockReturnValue({
      mediaType: "image/png",
      name: "x.png",
      size: 2,
      bytes: new Uint8Array([9, 9]),
    })
    const ecpWithStore = {
      invoke: vi.fn(),
      getArtifactStore: () => ({ get }),
    }
    const handler = createUpRequestHandler({
      ecp: ecpWithStore as never,
      allowOrigins: new Set(),
      token: "secret",
      ollamaUrl: "http://127.0.0.1:11434",
    })
    const out = createRes()
    await handler(
      createReq(
        "GET",
        "/v1/artifacts?uri=" +
          encodeURIComponent("ecp://artifacts/images/x.png") +
          "&token=secret",
        {}
      ),
      out.res
    )
    expect(out.statusCode).toBe(200)
    expect(out.headers["content-type"]).toBe("image/png")
    expect(get).toHaveBeenCalledWith("ecp://artifacts/images/x.png")
  })

  it("rejects /v1/describe without token", async () => {
    const handler = createUpRequestHandler({
      ecp: ecp as never,
      allowOrigins: new Set(),
      token: "secret",
      ollamaUrl: "http://127.0.0.1:11434",
    })
    const out = createRes()
    await handler(createReq("GET", "/v1/describe", {}), out.res)
    expect(out.statusCode).toBe(401)
  })

  it("returns host describe with a valid token", async () => {
    const describe = vi.fn().mockResolvedValue({
      schema: "@executioncontrolprotocol.environment.describe",
      version: "1.0.0",
      environment: { id: "ecp-up" },
      capabilities: [{ id: "@executioncontrolprotocol/ollama.generate", execution: "host" }],
    })
    const ecpDescribe = { invoke: vi.fn(), describe }
    const handler = createUpRequestHandler({
      ecp: ecpDescribe as never,
      allowOrigins: new Set(),
      token: "secret",
      ollamaUrl: "http://127.0.0.1:11434",
    })
    const out = createRes()
    await handler(
      createReq("GET", "/v1/describe", { authorization: "Bearer secret" }),
      out.res
    )
    expect(out.statusCode).toBe(200)
    expect(JSON.parse(out.body)).toMatchObject({
      environment: { id: "ecp-up" },
      capabilities: [{ id: "@executioncontrolprotocol/ollama.generate" }],
    })
    expect(describe).toHaveBeenCalled()
  })

  it("invokes a capability with a valid token", async () => {
    const process = vi.fn().mockResolvedValue({
      success: true,
      result: { models: ["a"] },
    })
    const withFn = vi.fn().mockReturnValue({ process, uses: vi.fn() })
    ecp.invoke.mockReturnValue({ with: withFn })

    const handler = createUpRequestHandler({
      ecp: ecp as never,
      allowOrigins: new Set(),
      token: "secret",
      ollamaUrl: "http://127.0.0.1:11434",
    })
    const out = createRes()
    await handler(
      createReq(
        "POST",
        "/v1/invoke",
        {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        JSON.stringify({
          capability: "@executioncontrolprotocol/ollama.listModels",
          input: {},
        })
      ),
      out.res
    )
    expect(out.statusCode).toBe(200)
    expect(JSON.parse(out.body)).toMatchObject({ success: true })
    expect(ecp.invoke).toHaveBeenCalledWith("@executioncontrolprotocol/ollama.listModels")
  })
})
