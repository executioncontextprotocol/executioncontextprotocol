import {
  ANTHROPIC_CLAUDE_SONNET_45_EVAL,
  type AnthropicClaudeSonnetEvalProfile,
} from "../profiles/anthropic-sonnet.js"

/** Anthropic coding-matrix readiness result. @category Evals */
export interface AnthropicEvalReadiness {
  /** Whether ANTHROPIC_API_KEY is present for live evals. */
  ready: boolean
  /** Human-readable skip reason when not ready. */
  reason?: string
  /** Active profile id. */
  profileId: string
  /** Model tag from the profile. */
  model: string
}

/**
 * Coding matrix readiness for Anthropic — ready when `ANTHROPIC_API_KEY` is set.
 * @category Evals
 */
export async function anthropicEvalReady(
  profile: AnthropicClaudeSonnetEvalProfile = ANTHROPIC_CLAUDE_SONNET_45_EVAL
): Promise<AnthropicEvalReadiness> {
  const { id: profileId, model } = profile
  const key =
    typeof process !== "undefined" && typeof process.env?.ANTHROPIC_API_KEY === "string"
      ? process.env.ANTHROPIC_API_KEY.trim()
      : ""
  if (!key) {
    return {
      ready: false,
      reason: "ANTHROPIC_API_KEY is not set",
      profileId,
      model: model!,
    }
  }
  return { ready: true, profileId, model: model! }
}
