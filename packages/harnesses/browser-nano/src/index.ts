/**
 * Browser Nano harness (`@executioncontrolprotocol/harness-browser-nano`): workflow authoring, intent, assistant.
 * Tuned for on-device and ~1B models. Used by browser demo and `@executioncontrolprotocol/evals` matrix tests.
 * @category Harness
 */
export {
  BROWSER_NANO_HARNESS_ID,
  BROWSER_NANO_HARNESS_CAPABILITY,
} from "./harness-ids.js"

export {
  registerBrowserNanoHarnesses,
  resetBrowserNanoHarnessRegistrationForTests,
} from "./register.js"

export {
  HARNESS_TASKS,
  HARNESS_NANO_REPAIR,
  HARNESS_NANO_CHAT_REPAIR,
  HARNESS_NANO_TRACE,
  HARNESS_NANO_BINDING,
  getHarnessNanoConfig,
  type HarnessTask,
} from "./harness-nano-config.js"

export type { BrowserNanoHarnessInput } from "./browser-nano-harness.js"

export {
  chatResultAnswer,
  chatResultWorkflow,
  chatResultSuggestedAction,
  intentRoutesToAuthoring,
  invokeMultiShotChat,
  WORKFLOW_CHANGE_SUMMARY_SHOT_TASK,
} from "./multi-shot-chat.js"

export {
  buildPatchOperationHintLines,
  buildRequestCapabilityHintLines,
  collectPatchGoalFeedback,
  collectCreateCapabilityFeedback,
  collectCreateDuplicateStepIdFeedback,
  collectCreateStepCountFeedback,
  collectCreateWorkflowIoFeedback,
  collectGenerateReturnsTypeFeedback,
  inferPatchTargetStepId,
  inferRequiredCapabilityIds,
  inferRequiredStepCount,
} from "./_internal/request-capability-hints.js"

export {
  NANO_PROMPT_FIXTURE_IDS,
  buildNanoRepairHint,
  buildNanoSystemPrompt,
  loadNanoHarnessPromptFixture,
  type NanoPromptFixtureId,
} from "./prompts/index.js"
