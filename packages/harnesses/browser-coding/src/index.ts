export {
  BROWSER_CODING_HARNESS_ID,
  BROWSER_CODING_HARNESS_CAPABILITY,
} from "./harness-ids.js"
export {
  HARNESS_TASKS,
  HARNESS_CODING_BINDING,
  HARNESS_CODING_REPAIR,
  HARNESS_CODING_CHAT_REPAIR,
  HARNESS_CODING_TRACE,
  getHarnessCodingConfig,
  type HarnessTask,
  type HarnessCodingProfile,
} from "./harness-coding-config.js"
export {
  registerBrowserCodingHarnesses,
  resetBrowserCodingHarnessRegistrationForTests,
} from "./register.js"
export type { BrowserCodingHarnessInput } from "./browser-coding-harness.js"
export {
  chatResultAnswer,
  chatResultWorkflow,
  chatResultSuggestedAction,
  invokeMultiShotChatCoding,
} from "./multi-shot-chat.js"
export {
  CODING_PROMPT_FIXTURE_IDS,
  buildCodingRepairHint,
  buildCodingSystemPrompt,
  loadCodingHarnessPromptFixture,
  type CodingPromptFixtureId,
} from "./prompts/index.js"
