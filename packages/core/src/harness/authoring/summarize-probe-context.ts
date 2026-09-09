import {
  PROBE_CONTEXT_DOMAINS,
  type ProbeContext,
  type ProbeOption,
} from "@executioncontrolprotocol/types"

/** Max options listed in prompt summaries before truncation. @category Harness */
export const PROBE_CONTEXT_OPTION_PROMPT_LIMIT = 24

/**
 * Format {@link ProbeContext} as prompt lines for clarify / complete shots.
 * @category Harness
 */
export function summarizeProbeContext(probe: ProbeContext): string[] {
  const lines = [
    `Probe domain: ${probe.domain}`,
    `Probe summary: ${probe.summary}`,
  ]
  if (probe.cursor) {
    lines.push(`Probe cursor: ${probe.cursor}`)
  }
  if (probe.stepAs) {
    lines.push(`Probe step .as: ${probe.stepAs}`)
  }

  if (probe.options.length === 0) {
    lines.push("Probe options: (none)")
    return lines
  }

  const limited = probe.options.slice(0, PROBE_CONTEXT_OPTION_PROMPT_LIMIT)
  lines.push("Probe options:")
  for (const option of limited) {
    const path = option.path ? ` path=${option.path}` : ""
    lines.push(`- ${option.label} (id=${option.id})${path}`)
  }
  if (probe.options.length > limited.length) {
    lines.push(`- ...and ${probe.options.length - limited.length} more`)
  }
  return lines
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}

function layerLabel(node: Record<string, unknown>, fallbackId: string): string {
  const name = typeof node.name === "string" ? node.name.trim() : ""
  if (name) return name
  const title = typeof node.title === "string" ? node.title.trim() : ""
  if (title) return title
  return fallbackId
}

function layerId(node: Record<string, unknown>, index: number, path: string): string {
  if (typeof node.id === "string" && node.id.trim()) return node.id.trim()
  if (typeof node.id === "number") return String(node.id)
  if (typeof node.layerId === "string" && node.layerId.trim()) return node.layerId.trim()
  if (typeof node.layerId === "number") return String(node.layerId)
  return `${path || "layer"}-${index}`
}

function collectLayerOptions(
  nodes: unknown,
  pathPrefix: string,
  out: ProbeOption[]
): void {
  if (!Array.isArray(nodes)) return
  nodes.forEach((node, index) => {
    if (!isRecord(node)) return
    const path = pathPrefix ? `${pathPrefix}.${index}` : String(index)
    const id = layerId(node, index, pathPrefix || "layer")
    const children = node.children ?? node.layers
    const hasChildren = Array.isArray(children) && children.length > 0
    // Leaf layers and named groups are both selectable; recurse into children.
    out.push({
      id,
      label: layerLabel(node, id),
      path: `layers.${path}`,
      ...(typeof node.type === "string" ? { meta: { type: node.type } } : {}),
    })
    if (hasChildren) {
      collectLayerOptions(children, path, out)
    }
  })
}

/**
 * Build {@link ProbeOption} rows from a Photoshop generate-manifest document.
 * Accepts either a full step output or a `{ layers: [...] }` tree.
 * @category Harness
 */
export function probeOptionsFromPhotoshopManifest(manifest: unknown): ProbeOption[] {
  if (!isRecord(manifest)) return []
  const layers =
    Array.isArray(manifest.layers)
      ? manifest.layers
      : isRecord(manifest.manifest) && Array.isArray(manifest.manifest.layers)
        ? manifest.manifest.layers
        : isRecord(manifest.result) && Array.isArray(manifest.result.layers)
          ? manifest.result.layers
          : undefined
  if (!layers) return []
  const options: ProbeOption[] = []
  collectLayerOptions(layers, "", options)
  return options
}

/**
 * Build a {@link ProbeContext} for the Photoshop layers exemplar.
 * @category Harness
 */
export function buildPhotoshopLayersProbeContext(input: {
  probeId: string
  manifest: unknown
  cursor?: string
  stepAs?: string
  summary?: string
}): ProbeContext {
  const options = probeOptionsFromPhotoshopManifest(input.manifest)
  const summary =
    input.summary ??
    (options.length > 0
      ? `Discovered ${options.length} Photoshop layer option(s).`
      : "No Photoshop layers discovered.")
  return {
    probeId: input.probeId,
    domain: PROBE_CONTEXT_DOMAINS.PHOTOSHOP_LAYERS,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.stepAs ? { stepAs: input.stepAs } : {}),
    summary,
    options,
  }
}

/**
 * True when the user message already names enough probe options to skip a redundant ask.
 * @category Harness
 */
export function messageSelectsProbeOptions(
  message: string,
  probe: ProbeContext,
  minMatches = 1
): boolean {
  const lower = message.toLowerCase()
  let matches = 0
  for (const option of probe.options) {
    if (
      lower.includes(option.label.toLowerCase()) ||
      lower.includes(option.id.toLowerCase())
    ) {
      matches += 1
    }
  }
  return matches >= minMatches
}
