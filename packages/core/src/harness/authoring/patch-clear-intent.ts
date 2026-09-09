/**
 * Detect patch requests that clear every workflow step (remove all / start fresh).
 * Distinguishes from CLEAR ACCEPTS / CLEAR RETURNS and single-step removes.
 * @category Harness
 */

/**
 * True when the user asks to wipe all steps or start the graph over while keeping
 * the same workflow (patch), not when they only clear accepts/returns.
 * @category Harness
 */
export function isClearAllStepsRequest(request: string): boolean {
  const text = request.trim()
  if (!text) {
    return false
  }
  const lower = text.toLowerCase()

  // I/O-only clears must not wipe steps.
  if (/\bclear\s+(accepts|returns)\b/i.test(lower)) {
    return false
  }
  if (
    /\b(remove|delete|clear)\b[\s\w-]*\b(workflow\s+)?returns?\b/i.test(lower) &&
    !/\bsteps?\b/.test(lower)
  ) {
    return false
  }

  return (
    /\b(remove|delete)\s+all(\s+the)?\s+steps?\b/i.test(lower) ||
    /\b(remove|delete)\s+every\s+step\b/i.test(lower) ||
    /\bclear\s+all(\s+the)?\s+steps?\b/i.test(lower) ||
    /\bclear\s+(the\s+)?steps?\b/i.test(lower) ||
    /\bclear\s+(the\s+)?workflow\b/i.test(lower) ||
    /\b(empty|wipe)\s+(the\s+)?(workflow|steps?)\b/i.test(lower) ||
    /\bwipe\s+all\b/i.test(lower) ||
    /\bstart\s+(over|fresh)\b/i.test(lower) ||
    (/\bstart\s+from\s+scratch\b/i.test(lower) &&
      /\b(workflow|steps?|existing)\b/i.test(lower))
  )
}

/**
 * True when a clear-all request also asks to add or rebuild steps afterward.
 * @category Harness
 */
export function isClearAndRebuildRequest(request: string): boolean {
  if (!isClearAllStepsRequest(request)) {
    return false
  }
  return (
    /\b(add|insert|append|include|with\s+(?:a\s+)?(?:one|single|new)|using\s+@|rebuild|replace)\b/i.test(
      request
    ) || /\bstart\s+fresh\s+with\b/i.test(request)
  )
}
