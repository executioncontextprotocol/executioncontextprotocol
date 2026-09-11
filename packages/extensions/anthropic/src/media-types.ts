/** Anthropic Messages image MIME types. @category Extensions */
export const ANTHROPIC_GENERATE_IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const

/** Anthropic Messages document MIME types. @category Extensions */
export const ANTHROPIC_GENERATE_DOCUMENT_MEDIA_TYPES = ["application/pdf"] as const

/** All MIME types accepted by anthropic.generate files. @category Extensions */
export const ANTHROPIC_GENERATE_MEDIA_TYPES = [
  ...ANTHROPIC_GENERATE_IMAGE_MEDIA_TYPES,
  ...ANTHROPIC_GENERATE_DOCUMENT_MEDIA_TYPES,
] as const

/** Anthropic image MIME union. @category Extensions */
export type AnthropicGenerateImageMediaType =
  (typeof ANTHROPIC_GENERATE_IMAGE_MEDIA_TYPES)[number]

/** Anthropic document MIME union. @category Extensions */
export type AnthropicGenerateDocumentMediaType =
  (typeof ANTHROPIC_GENERATE_DOCUMENT_MEDIA_TYPES)[number]

/** Anthropic generate file MIME union. @category Extensions */
export type AnthropicGenerateMediaType = (typeof ANTHROPIC_GENERATE_MEDIA_TYPES)[number]

const IMAGE_SET = new Set<string>(ANTHROPIC_GENERATE_IMAGE_MEDIA_TYPES)
const DOCUMENT_SET = new Set<string>(ANTHROPIC_GENERATE_DOCUMENT_MEDIA_TYPES)

/** Whether MIME is an Anthropic image block type. @category Extensions */
export function isAnthropicImageMediaType(mediaType: string): mediaType is AnthropicGenerateImageMediaType {
  return IMAGE_SET.has(mediaType)
}

/** Whether MIME is an Anthropic document block type. @category Extensions */
export function isAnthropicDocumentMediaType(
  mediaType: string
): mediaType is AnthropicGenerateDocumentMediaType {
  return DOCUMENT_SET.has(mediaType)
}

/** Whether MIME is accepted by anthropic.generate files. @category Extensions */
export function isAnthropicGenerateMediaType(mediaType: string): mediaType is AnthropicGenerateMediaType {
  return IMAGE_SET.has(mediaType) || DOCUMENT_SET.has(mediaType)
}
