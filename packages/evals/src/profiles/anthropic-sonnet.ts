import type { EvalProviderProfile } from "./eval-provider.js"

/**
 * Baked Anthropic + Claude Sonnet 4.5 profile for Browser Coding harness evals.
 * @category Evals
 */
export const ANTHROPIC_CLAUDE_SONNET_45_EVAL = {
  id: "anthropic-claude-sonnet-4-5",
  providerId: "@executioncontrolprotocol/anthropic",
  generateCapability: "@executioncontrolprotocol/anthropic.generate",
  runtime: "node",
  model: "claude-sonnet-4-5",
  extensionBinding: {
    defaultModel: "claude-sonnet-4-5",
  },
} as const satisfies EvalProviderProfile

/** @category Evals */
export type AnthropicClaudeSonnetEvalProfile = typeof ANTHROPIC_CLAUDE_SONNET_45_EVAL
