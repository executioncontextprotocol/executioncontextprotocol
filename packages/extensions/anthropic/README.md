# `@executioncontrolprotocol/anthropic`

Anthropic Messages API model provider for ECP (`anthropic.generate` / `anthropic.evaluate`).

## Auth

- Extension config `apiKey`, or
- `ANTHROPIC_API_KEY` from the process environment (Node)

Browser demo BYOK uses the vault secret `ANTHROPIC_API_KEY` with local execution and the
`anthropic-dangerous-direct-browser-access` header.

## Multimodal `files`

Optional `files` on `model.generate` are portable `FileRef` values. Supported MIME types:

| Kind | MIME |
| ---- | ---- |
| Image | `image/jpeg`, `image/png`, `image/gif`, `image/webp` |
| Document | `application/pdf` |

Unsupported MIME types are rejected before the API call.
