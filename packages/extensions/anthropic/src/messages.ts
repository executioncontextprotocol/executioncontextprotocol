import {
  FILE_REF_KINDS,
  type FileRef,
  type ModelGenerateInput,
} from "@executioncontrolprotocol/types"
import { resolveFile, type FileCapabilityContext } from "@executioncontrolprotocol/core"
import {
  isAnthropicDocumentMediaType,
  isAnthropicGenerateMediaType,
  isAnthropicImageMediaType,
  type AnthropicGenerateDocumentMediaType,
  type AnthropicGenerateImageMediaType,
} from "./media-types.js"

/** Default max tokens when options omit max_tokens. @category Extensions */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096

/** Default Claude model for generate. @category Extensions */
export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-5"

interface AnthropicTextBlock {
  type: "text"
  text: string
}

interface AnthropicImageBlock {
  type: "image"
  source:
    | {
        type: "base64"
        media_type: AnthropicGenerateImageMediaType
        data: string
      }
    | {
        type: "url"
        url: string
      }
}

interface AnthropicDocumentBlock {
  type: "document"
  source:
    | {
        type: "base64"
        media_type: AnthropicGenerateDocumentMediaType
        data: string
      }
    | {
        type: "url"
        url: string
      }
}

/** Anthropic user message content block. @category Extensions */
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicDocumentBlock

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64")
  }
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function normalizeMediaType(mediaType: string | undefined, fallbackHint?: string): string {
  const raw = (mediaType ?? fallbackHint ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
  if (raw === "image/jpg") return "image/jpeg"
  return raw
}

/**
 * Map portable file refs to Anthropic Messages content blocks (media before text).
 * @category Extensions
 */
export async function buildAnthropicUserContent(
  prompt: string,
  files: FileRef[] | undefined,
  ctx: FileCapabilityContext
): Promise<AnthropicContentBlock[]> {
  const mediaBlocks: AnthropicContentBlock[] = []
  for (const ref of files ?? []) {
    if (ref.kind === FILE_REF_KINDS.URL) {
      const mediaType = normalizeMediaType(ref.mediaType)
      if (!mediaType || !isAnthropicGenerateMediaType(mediaType)) {
        throw new Error(
          `Unsupported Anthropic generate file media type: ${mediaType || "(missing)"}. Allowed: image/jpeg, image/png, image/gif, image/webp, application/pdf`
        )
      }
      if (isAnthropicImageMediaType(mediaType)) {
        mediaBlocks.push({ type: "image", source: { type: "url", url: ref.url } })
      } else {
        mediaBlocks.push({ type: "document", source: { type: "url", url: ref.url } })
      }
      continue
    }

    const resolved = await resolveFile(ref, ctx, { allowRemoteUrls: false })
    const mediaType = normalizeMediaType(resolved.mediaType, ref.mediaType)
    if (!mediaType || !isAnthropicGenerateMediaType(mediaType)) {
      throw new Error(
        `Unsupported Anthropic generate file media type: ${mediaType || "(missing)"}. Allowed: image/jpeg, image/png, image/gif, image/webp, application/pdf`
      )
    }
    const data = bytesToBase64(resolved.bytes)
    if (isAnthropicImageMediaType(mediaType)) {
      mediaBlocks.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data },
      })
    } else if (isAnthropicDocumentMediaType(mediaType)) {
      mediaBlocks.push({
        type: "document",
        source: { type: "base64", media_type: mediaType, data },
      })
    }
  }
  return [...mediaBlocks, { type: "text", text: prompt }]
}

/** Resolve sampling options for Anthropic (temperature XOR top_p). @category Extensions */
export function resolveAnthropicSamplingOptions(
  options: Record<string, unknown> | undefined
): { max_tokens: number; temperature?: number; top_p?: number } {
  const maxTokensRaw = options?.max_tokens ?? options?.maxTokens
  const max_tokens =
    typeof maxTokensRaw === "number" && Number.isFinite(maxTokensRaw) && maxTokensRaw > 0
      ? Math.floor(maxTokensRaw)
      : ANTHROPIC_DEFAULT_MAX_TOKENS

  const temperature =
    typeof options?.temperature === "number" && Number.isFinite(options.temperature)
      ? options.temperature
      : undefined
  const topP =
    typeof options?.top_p === "number" && Number.isFinite(options.top_p)
      ? options.top_p
      : typeof options?.topP === "number" && Number.isFinite(options.topP)
        ? options.topP
        : undefined

  // Anthropic rejects setting both temperature and top_p.
  if (temperature !== undefined) {
    return { max_tokens, temperature }
  }
  if (topP !== undefined) {
    return { max_tokens, top_p: topP }
  }
  return { max_tokens }
}

/** Build Messages API body fields from normalized generate input. @category Extensions */
export function resolveAnthropicModel(
  input: Pick<ModelGenerateInput, "model">,
  cfg: Record<string, unknown>
): string {
  return input.model ?? (cfg.defaultModel as string | undefined) ?? ANTHROPIC_DEFAULT_MODEL
}
