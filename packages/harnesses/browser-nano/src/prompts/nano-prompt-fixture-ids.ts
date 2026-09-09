/** Browser Nano harness prompt fixture ids. @category Harness */
export const NANO_PROMPT_FIXTURE_IDS = {
  INTENT_CLASSIFICATION: "intent-classification",
  WORKFLOW_AUTHORING_CREATE: "workflow-authoring-create",
  WORKFLOW_AUTHORING_PATCH: "workflow-authoring-patch",
  WORKFLOW_ASSISTANT: "workflow-assistant",
  WORKFLOW_CHANGE_SUMMARY: "workflow-change-summary",
} as const

/** Browser Nano harness prompt fixture id union. @category Harness */
export type NanoPromptFixtureId =
  (typeof NANO_PROMPT_FIXTURE_IDS)[keyof typeof NANO_PROMPT_FIXTURE_IDS]
