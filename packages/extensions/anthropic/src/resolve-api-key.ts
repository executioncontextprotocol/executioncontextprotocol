/** Resolve Anthropic API key from extension config, optionally process.env on Node. */
export function resolveAnthropicApiKey(cfg: Record<string, unknown>): string {
  const fromConfig = cfg.apiKey as string | undefined
  if (fromConfig) return fromConfig
  if (typeof process !== "undefined" && process.env?.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY
  }
  return ""
}
