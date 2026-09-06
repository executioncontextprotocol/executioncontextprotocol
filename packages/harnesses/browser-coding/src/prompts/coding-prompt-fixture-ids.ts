/** Browser Coding harness prompt fixture ids. @category Harness */
export const CODING_PROMPT_FIXTURE_IDS = {
  INTENT_CLASSIFICATION: "intent-classification-coding",
  WORKFLOW_AUTHORING_CREATE: "workflow-authoring-create-coding",
  WORKFLOW_AUTHORING_PATCH: "workflow-authoring-patch-coding",
  WORKFLOW_ASSISTANT: "workflow-assistant-coding",
  WORKFLOW_CHANGE_SUMMARY: "workflow-change-summary-coding",
} as const

/** Browser Coding harness prompt fixture id union. @category Harness */
export type CodingPromptFixtureId =
  (typeof CODING_PROMPT_FIXTURE_IDS)[keyof typeof CODING_PROMPT_FIXTURE_IDS]
