import { writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/cases")
const matrixExt = ["@executioncontrolprotocol/format-toon", "@executioncontrolprotocol/format-eql", "@executioncontrolprotocol/format-json", "@executioncontrolprotocol/test"]
const chromeGen = "@executioncontrolprotocol/chrome-ai.generate"
const offTopicJudge = {
  enabled: true,
  goal: "Politely declines off-topic request and redirects to ECP/workflow topics",
  rubric: "Brief polite decline mentioning workflows, ECP, or capabilities",
  requireApproved: true,
}
const baseDet = [
  { kind: "invokeSuccess" },
  { kind: "artifactSchema", value: "@executioncontrolprotocol.workflow" },
  { kind: "validationValid" },
  { kind: "descriptorListsExtensions", ids: matrixExt },
]

function writeSuite(name, cases) {
  writeFileSync(path.join(root, `${name}.cases.json`), JSON.stringify({ cases }, null, 2) + "\n")
}

const creates = [
  ["wf-create-01", "Minimal generate", `Create a minimal @executioncontrolprotocol.workflow with one step that uses ${chromeGen} to summarize the text hello in one sentence.`, [{ kind: "stepUses", capabilityId: chromeGen }, { kind: "stepCount", exact: 1 }]],
  ["wf-create-02", "Poem then summarize", `Create a two-step workflow: generate a short poem with ${chromeGen}, then summarize that poem with the same capability.`, [{ kind: "stepCount", min: 2 }, { kind: "stepUses", capabilityId: chromeGen }]],
  ["wf-create-03", "Email then actions", `Create a workflow that generates a sample email with ${chromeGen}, then extracts action items with the same capability.`, [{ kind: "stepCount", exact: 2 }, { kind: "stepUses", capabilityId: chromeGen }]],
  ["wf-create-04", "Haiku then explain", `Create a workflow that writes a haiku with ${chromeGen}, then explains the haiku with the same capability.`, [{ kind: "stepCount", exact: 2 }, { kind: "stepUses", capabilityId: chromeGen }]],
  ["wf-create-05", "Trivia critique", `Create a 3-step workflow using ${chromeGen}: ask a trivia question, draft an answer, then critique the answer.`, [{ kind: "stepCount", exact: 3 }, { kind: "stepUses", capabilityId: chromeGen }]],
  ["wf-create-06", "Spanish label", `Crea un flujo con un paso generate usando ${chromeGen}.`, [{ kind: "stepUses", capabilityId: chromeGen }]],
  ["wf-create-07", "French label", `Créez un workflow avec une étape ${chromeGen}.`, [{ kind: "stepUses", capabilityId: chromeGen }]],
  ["wf-create-08", "German label", `Erstelle einen Workflow mit ${chromeGen}.`, [{ kind: "stepUses", capabilityId: chromeGen }]],
  ["wf-create-09", "Triple generate chain", `Create a 3-step workflow using ${chromeGen} for question, answer, and critique steps.`, [{ kind: "stepCount", min: 3 }, { kind: "stepUses", capabilityId: chromeGen }]],
  ["wf-create-10", "Workflow id chrome-summarize", `Create workflow id chrome-summarize with one ${chromeGen} step labeled Summarize.`, [{ kind: "stepUses", capabilityId: chromeGen }, { kind: "stepCount", exact: 1 }]],
  ["wf-create-11", "Quality judge", `Design a clear production workflow using ${chromeGen} for content generation.`, [], { enabled: true, goal: "Workflow is coherent and references chrome-ai.generate", requireApproved: true }],
  ["wf-create-12", "Descriptor caps", `List capabilities then create generate-only workflow with ${chromeGen}.`, [{ kind: "descriptorListsCapabilities", ids: [chromeGen] }]],
].map(([id, title, request, extra, judge]) => ({
  id,
  suite: "workflow-create",
  title,
  harness: "workflow-authoring",
  model: "default",
  input: { request },
  assertions: { deterministic: [...baseDet, ...extra], judge: judge ?? { enabled: false } },
}))

const patches = [
  ["wf-patch-01", "Label change", "Change the poem step label to Draft Poem.", "workflows/two-step-generate-chain.json", [{ kind: "stepLabel", stepId: "poem", value: "Draft Poem" }]],
  ["wf-patch-02", "Input value", "Set poem prompt to Write a short poem about rivers.", "workflows/two-step-generate-chain.json", []],
  ["wf-patch-03", "Add critique", `Add a critique step after summarize using ${chromeGen}.`, "workflows/two-step-generate-chain.json", [{ kind: "stepCount", min: 3 }, { kind: "stepUses", capabilityId: chromeGen }]],
  ["wf-patch-04", "Remove critique", "Remove the critique step from the workflow.", "workflows/three-step-generate-workflow.json", [{ kind: "stepRemoved", stepId: "critique" }]],
  ["wf-patch-05", "Workflow label", "Change workflow label to Updated Poem Chain.", "workflows/two-step-generate-chain.json", [{ kind: "workflowLabel", value: "Updated Poem Chain" }]],
  ["wf-patch-06", "Step config", "Change summarize step label to Short Summary.", "workflows/two-step-generate-chain.json", [{ kind: "stepLabel", stepId: "summarize", value: "Short Summary" }]],
  ["wf-patch-07", "Ref chain", "Ensure summarize context references poem text via $ref.", "workflows/two-step-generate-chain.json", [{ kind: "inputRefPresent", stepId: "summarize" }]],
  ["wf-patch-08", "Add title", `Insert a title step before poem using ${chromeGen}.`, "workflows/two-step-generate-chain.json", [{ kind: "stepUses", capabilityId: chromeGen }, { kind: "stepCount", min: 3 }]],
  ["wf-patch-09", "Combined", `Add explain after poem and remove summarize if present using ${chromeGen}.`, "workflows/two-step-generate-chain.json", []],
  ["wf-patch-10", "Patch judge", "Improve poem label to be user friendly.", "workflows/two-step-generate-chain.json", [], { enabled: true, goal: "Patch is minimal and correct", requireApproved: true }],
  ["wf-patch-11", "Rename email label", "Rename the email step label to Draft Meeting Email.", "workflows/email-action-workflow.json", [{ kind: "stepLabel", stepId: "email", value: "Draft Meeting Email" }]],
  ["wf-patch-12", "Move summarize", "Move the summarize step to run after poem.", "workflows/two-step-generate-chain.json", [{ kind: "stepOrder", stepIds: ["poem", "summarize"] }]],
].map(([id, title, request, baseline, extra, judge]) => ({
  id,
  suite: "workflow-patch",
  title,
  harness: "workflow-authoring",
  model: "default",
  baselineWorkflow: baseline,
  input: { request },
  assertions: {
    deterministic: [
      { kind: "invokeSuccess" },
      { kind: "artifactSchema", value: "@executioncontrolprotocol.workflow" },
      { kind: "validationValid" },
      ...extra,
    ],
    judge: judge ?? { enabled: false },
  },
}))

const intents = [
  ["intent-01", "Salutation", "Hello there!", "general", false],
  ["intent-02", "FAQ", "What is ECP?", "faq", false],
  ["intent-03", "Create", "Create a new workflow that sends a summary email.", "workflow-create", true],
  ["intent-04", "Patch", "Update the poem step prompt to mention rivers.", "workflow-patch", false],
  ["intent-05", "Capabilities", "What extensions are available in this environment?", "general", true],
  ["intent-06", "Error symptom", "My workflow failed on the poem step with an error.", "workflow-patch", true],
  ["intent-07", "Bonjour", "Bonjour!", "general", false],
  ["intent-08", "Hola create", "Crea un flujo nuevo con generate.", "workflow-create", true],
  ["intent-09", "General chat", "Tell me a joke.", "general", true],
  ["intent-10", "Patch config", "Change the workflow step configuration for summarize.", "workflow-patch", false],
  ["intent-11", "FAQ how", "How does workflow patching work?", "faq", true],
  ["intent-12", "Build", "Build a pipeline with poem and summarize generate steps.", "workflow-create", true],
  ["intent-13", "Identity", "What can you do?", "general", true],
  ["intent-14", "Off-topic recipe", "Best pizza recipe?", "general", true],
  ["intent-15", "FAQ patch how-to", "How does step patching work in ECP?", "faq", true],
  ["intent-16", "Label patch", "Change the poem step label to Draft Poem.", "workflow-patch", false],
  ["intent-17", "Off-topic weather", "What's the weather today?", "general", true],
].map(([id, title, message, intent, judge]) => ({
  id,
  suite: "intent",
  title,
  harness: "intent-classification",
  model: "default",
  input: { message },
  assertions: {
    deterministic: [
      { kind: "invokeSuccess" },
      { kind: "intent", value: intent },
      { kind: "descriptorListsExtensions", ids: matrixExt },
    ],
    judge: judge
      ? { enabled: true, goal: `Intent should be ${intent}`, requireApproved: true }
      : { enabled: false },
  },
}))

const assistants = [
  ["asst-01", "Failed generate", "Why did step poem fail?", "runs/failed-generate-step.json", [{ kind: "answerContains", text: "poem" }, { kind: "answerContains", text: "error" }], { enabled: true, goal: "Explains generate failure", rubric: "Mentions poem step and describes the error from run context", requireApproved: true }],
  ["asst-02", "Failed status", "What is the run status?", "runs/failed-generate-step.json", [{ kind: "answerContains", text: "fail" }], false],
  ["asst-03", "Running", "Is my workflow still running?", "runs/running-pending.json", [{ kind: "answerContains", text: "run" }], false],
  ["asst-04", "Extensions", "What plugins and extensions can you use?", null, [{ kind: "answerContains", text: "ecp" }], { enabled: true, goal: "Extensions", rubric: "Lists ECP extensions or plugins loaded in this environment", requireApproved: true }],
  ["asst-05", "Steps", "What steps are in the workflow?", "runs/failed-generate-step.json", [], false],
  ["asst-06", "Fix suggest", "How can I fix the poem error?", "runs/failed-generate-step.json", [{ kind: "citationStepId", value: "poem" }], true],
  ["asst-07", "Output", "What did the poem step produce?", "runs/completed-with-refs.json", [], false],
  ["asst-08", "Tone judge", "Explain the failure politely.", "runs/failed-generate-step.json", [{ kind: "answerContains", text: "error" }], { enabled: true, goal: "Professional helpful tone", rubric: "Polite explanation of the generate error with actionable guidance", requireApproved: true }],
  ["asst-09", "Confirm patch", "Should we patch step poem input?", "runs/failed-generate-step.json", [], { enabled: true, goal: "Confirm patch", rubric: "Affirms patching poem step input when appropriate", requireApproved: true }],
  ["asst-10", "Capabilities list", "List supported step capabilities.", null, [{ kind: "answerContains", text: "chrome-ai.generate" }], { enabled: true, goal: "Capabilities list", rubric: "Names concrete step capability ids such as chrome-ai.generate", requireApproved: true }],
  ["asst-11", "What is ECP", "What is ECP?", null, [{ kind: "answerContains", text: "ECP" }], { enabled: true, goal: "Defines ECP in one or two sentences", rubric: "Mentions workflows or governed environments", requireApproved: true }],
  ["asst-12", "Identity", "What can you do?", null, [{ kind: "answerContains", text: "workflow" }], { enabled: true, goal: "States assistant capabilities", rubric: "Mentions building workflows and answering ECP or environment questions", requireApproved: true }],
  ["asst-13", "Register refusal", "Register a new extension for me.", null, [{ kind: "answerContains", text: "cannot" }], { enabled: true, goal: "Graceful refusal", rubric: "Explains cannot register and offers alternatives", requireApproved: true }],
  ["asst-14", "Environment help", "What capabilities are available?", null, [{ kind: "answerContains", text: "chrome-ai.generate" }], { enabled: true, goal: "Lists capabilities", rubric: "Names capability ids from the environment", requireApproved: true }],
  ["asst-15", "Off-topic joke", "Tell me a joke.", null, [{ kind: "answerRedirectsToScope" }], offTopicJudge],
  ["asst-16", "Off-topic weather", "What's the weather today?", null, [{ kind: "answerRedirectsToScope" }], offTopicJudge],
  ["asst-17", "Off-topic cover letter", "Write a cover letter for a software job.", null, [{ kind: "answerRedirectsToScope" }, { kind: "answerMaxLength", max: 220 }], offTopicJudge],
  ["asst-18", "Gibberish", "asdf qwerty ???", null, [{ kind: "answerRedirectsToScope" }], offTopicJudge],
  ["asst-19", "MCP vs ECP", "How is MCP different from ECP?", null, [{ kind: "answerContains", text: "ECP" }], { enabled: true, goal: "Contrasts MCP and ECP", rubric: "Mentions both MCP and ECP in a brief accurate way", requireApproved: true }],
  ["asst-20", "Workflow definition", "What is a workflow in ECP?", null, [{ kind: "answerContains", text: "workflow" }], { enabled: true, goal: "Defines ECP workflow", rubric: "Mentions steps, capabilities, or portable manifests", requireApproved: true }],
  ["asst-21", "Off-topic task", "Write my resume.", null, [{ kind: "answerRedirectsToScope" }], offTopicJudge],
  ["asst-22", "FAQ brevity", "What is ECP?", null, [{ kind: "answerContains", text: "ECP" }, { kind: "answerMaxLength", max: 280 }, { kind: "rawNotContains", text: "```" }], { enabled: true, goal: "Defines ECP briefly", rubric: "One or two sentences, no markdown fences", requireApproved: true }],
].map(([id, title, message, runFixture, extra, judge]) => ({
  id,
  suite: "assistant",
  title,
  harness: "workflow-assistant",
  model: "default",
  input: {
    message,
    ...(runFixture ? { runContextFixture: runFixture } : {}),
  },
  assertions: {
    deterministic: [
      { kind: "invokeSuccess" },
      { kind: "replySchema" },
      ...extra,
    ],
    judge: typeof judge === "object" ? judge : judge ? { enabled: true, goal: title, requireApproved: true } : { enabled: false },
  },
}))

const flows = [
  {
    id: "flow-01",
    suite: "flow",
    title: "Troubleshoot then patch",
    model: "default",
    steps: [
      {
        harness: "intent-classification",
        input: { message: "The workflow failed on poem, help me fix it." },
        assertions: { deterministic: [{ kind: "intent", value: "workflow-patch" }], judge: { enabled: false } },
      },
      {
        harness: "workflow-authoring",
        input: {
          request: "Set poem prompt to Write a short poem about recovery.",
          manifestRef: "workflows/two-step-generate-chain.json",
        },
        assertions: { deterministic: [{ kind: "validationValid" }], judge: { enabled: false } },
      },
      {
        harness: "workflow-assistant",
        input: {
          message: "Confirm the fix applies to step poem?",
          runContextFixture: "runs/failed-generate-step.json",
        },
        assertions: {
          deterministic: [{ kind: "replySchema" }],
          judge: { enabled: true, goal: "Confirms poem step", requireApproved: true },
        },
      },
    ],
  },
  {
    id: "flow-02",
    suite: "flow",
    title: "Create routing",
    model: "default",
    steps: [
      {
        harness: "intent-classification",
        input: { message: "I need a new workflow with poem then summarize using generate." },
        assertions: { deterministic: [{ kind: "intent", value: "workflow-create" }], judge: { enabled: false } },
      },
      {
        harness: "workflow-authoring",
        input: {
          request: `Create poem then summarize workflow using ${chromeGen}.`,
        },
        assertions: { deterministic: [{ kind: "artifactSchema", value: "@executioncontrolprotocol.workflow" }], judge: { enabled: false } },
      },
    ],
  },
  {
    id: "flow-03",
    suite: "flow",
    title: "FAQ then general",
    model: "default",
    steps: [
      {
        harness: "intent-classification",
        input: { message: "How does patching work?" },
        assertions: { deterministic: [{ kind: "intent", value: "faq" }], judge: { enabled: false } },
      },
      {
        harness: "workflow-assistant",
        input: { message: "How does patching work?" },
        assertions: {
          deterministic: [{ kind: "replySchema" }, { kind: "answerContains", text: "patch" }],
          judge: { enabled: true, goal: "Explains patching", rubric: "Accurate ECP patching overview", requireApproved: true },
        },
      },
      {
        harness: "intent-classification",
        input: { message: "Thanks!" },
        assertions: { deterministic: [{ kind: "intent", value: "general" }], judge: { enabled: false } },
      },
      {
        harness: "workflow-assistant",
        input: { message: "Thanks!" },
        assertions: {
          deterministic: [{ kind: "replySchema" }],
          judge: { enabled: true, goal: "Polite acknowledgment", rubric: "Brief friendly reply", requireApproved: true },
        },
      },
    ],
  },
  {
    id: "flow-04",
    suite: "flow",
    title: "Patch chain refs",
    model: "default",
    steps: [
      {
        harness: "workflow-authoring",
        input: {
          request: "Ensure summarize context references poem text via $ref.",
          manifestRef: "workflows/two-step-generate-chain.json",
        },
        assertions: { deterministic: [{ kind: "inputRefPresent", stepId: "summarize" }], judge: { enabled: false } },
      },
      {
        harness: "workflow-assistant",
        input: {
          message: "Did the chain run complete?",
          runContextFixture: "runs/completed-with-refs.json",
        },
        assertions: { deterministic: [{ kind: "replySchema" }], judge: { enabled: true, goal: "Mentions completed run", requireApproved: true } },
      },
    ],
  },
  {
    id: "flow-05",
    suite: "flow",
    title: "Salutation to create",
    model: "default",
    steps: [
      {
        harness: "intent-classification",
        input: { message: "Hi!" },
        assertions: { deterministic: [{ kind: "intent", value: "general" }], judge: { enabled: false } },
      },
      {
        harness: "intent-classification",
        input: { message: "Actually create a generate workflow." },
        assertions: { deterministic: [{ kind: "intent", value: "workflow-create" }], judge: { enabled: false } },
      },
      {
        harness: "workflow-authoring",
        input: { request: `Create minimal ${chromeGen} workflow.` },
        assertions: { deterministic: [{ kind: "stepUses", capabilityId: chromeGen }], judge: { enabled: false } },
      },
    ],
  },
  {
    id: "flow-06",
    suite: "flow",
    title: "Error explain and patch",
    model: "default",
    steps: [
      {
        harness: "workflow-assistant",
        input: {
          message: "What error occurred?",
          runContextFixture: "runs/failed-generate-step.json",
        },
        assertions: {
          deterministic: [{ kind: "answerContains", text: "error" }],
          judge: { enabled: true, goal: "Describes generate failure", rubric: "Mentions poem and the error from the run context", requireApproved: true },
        },
      },
      {
        harness: "workflow-authoring",
        input: {
          request: "Set poem prompt to Write a short poem about the ocean.",
          manifestRef: "workflows/two-step-generate-chain.json",
        },
        assertions: { deterministic: [{ kind: "validationValid" }], judge: { enabled: false } },
      },
      {
        harness: "workflow-assistant",
        input: {
          message: "Where should the fix be applied?",
          runContextFixture: "runs/failed-generate-step.json",
        },
        assertions: {
          deterministic: [{ kind: "citationStepId", value: "poem" }],
          judge: { enabled: true, goal: "Points to poem step", rubric: "Identifies step poem as where to apply the fix", requireApproved: true },
        },
      },
    ],
  },
  {
    id: "flow-07",
    suite: "flow",
    title: "FAQ what is ECP routing",
    model: "default",
    steps: [
      {
        harness: "intent-classification",
        input: { message: "What is ECP?" },
        assertions: { deterministic: [{ kind: "intent", value: "faq" }], judge: { enabled: false } },
      },
      {
        harness: "workflow-assistant",
        input: { message: "What is ECP?" },
        assertions: {
          deterministic: [{ kind: "replySchema" }, { kind: "answerContains", text: "ECP" }],
          judge: { enabled: true, goal: "Defines ECP", rubric: "Mentions workflows or governed environments", requireApproved: true },
        },
      },
    ],
  },
  {
    id: "flow-08",
    suite: "flow",
    title: "Identity routing",
    model: "default",
    steps: [
      {
        harness: "intent-classification",
        input: { message: "What can you do?" },
        assertions: { deterministic: [{ kind: "intent", value: "general" }], judge: { enabled: false } },
      },
      {
        harness: "workflow-assistant",
        input: { message: "What can you do?" },
        assertions: {
          deterministic: [{ kind: "replySchema" }, { kind: "answerContains", text: "workflow" }],
          judge: { enabled: true, goal: "States assistant capabilities", rubric: "Mentions building workflows and answering ECP questions", requireApproved: true },
        },
      },
    ],
  },
  {
    id: "flow-09",
    suite: "flow",
    title: "Off-topic joke routing",
    model: "default",
    steps: [
      {
        harness: "intent-classification",
        input: { message: "Tell me a joke." },
        assertions: { deterministic: [{ kind: "intent", value: "general" }], judge: { enabled: false } },
      },
      {
        harness: "workflow-assistant",
        input: { message: "Tell me a joke." },
        assertions: {
          deterministic: [{ kind: "replySchema" }, { kind: "answerRedirectsToScope" }],
          judge: offTopicJudge,
        },
      },
    ],
  },
]

const chatCases = [
  {
    id: "chat-01",
    suite: "chat",
    title: "Troubleshoot failure routes to patch",
    harness: "chat",
    model: "default",
    input: {
      message: "The workflow failed on poem, help me fix it.",
      manifestRef: "workflows/two-step-generate-chain.json",
    },
    assertions: {
      deterministic: [
        { kind: "invokeSuccess" },
        { kind: "classifiedIntent", value: "workflow-patch" },
        { kind: "shotCount", value: 2 },
        { kind: "promptPhase", shotIndex: 0, value: "unfiltered" },
        { kind: "promptPhase", shotIndex: 1, value: "contextualized" },
        { kind: "validationValid" },
      ],
      judge: { enabled: false },
    },
  },
  {
    id: "chat-02",
    suite: "chat",
    title: "Create routing",
    harness: "chat",
    model: "default",
    input: { message: "I need a new workflow with poem then summarize using generate." },
    assertions: {
      deterministic: [
        { kind: "invokeSuccess" },
        { kind: "classifiedIntent", value: "workflow-create" },
        { kind: "shotCount", value: 2 },
        { kind: "artifactSchema", value: "@executioncontrolprotocol.workflow" },
        { kind: "sidecarStepUses", capabilityId: chromeGen },
      ],
      judge: { enabled: false },
    },
  },
  {
    id: "chat-03",
    suite: "chat",
    title: "FAQ how patching works",
    harness: "chat",
    model: "default",
    input: { message: "How does workflow patching work?" },
    assertions: {
      deterministic: [
        { kind: "invokeSuccess" },
        { kind: "classifiedIntent", value: "faq" },
        { kind: "classifiedTopic", contains: "patch" },
        { kind: "shotCount", value: 2 },
        { kind: "replySchema" },
      ],
      judge: {
        enabled: true,
        goal: "Explains ECP patching without changing a workflow",
        classifiedIntent: "faq",
        requireApproved: true,
      },
    },
  },
  {
    id: "chat-04",
    suite: "chat",
    title: "What is ECP",
    harness: "chat",
    model: "default",
    input: { message: "What is ECP?" },
    assertions: {
      deterministic: [
        { kind: "invokeSuccess" },
        { kind: "classifiedIntent", value: "faq" },
        { kind: "replySchema" },
        { kind: "answerContains", text: "ECP" },
      ],
      judge: {
        enabled: true,
        goal: "Defines ECP briefly",
        classifiedIntent: "faq",
        rubric: "One or two sentences, no markdown fences",
        requireApproved: true,
      },
    },
  },
  {
    id: "chat-05",
    suite: "chat",
    title: "Capabilities question",
    harness: "chat",
    model: "default",
    input: { message: "What extensions are available in this environment?" },
    assertions: {
      deterministic: [
        { kind: "invokeSuccess" },
        { kind: "classifiedIntent", value: "general" },
        { kind: "replySchema" },
        { kind: "answerContains", text: "ecp" },
      ],
      judge: {
        enabled: true,
        goal: "Lists ECP extensions",
        classifiedIntent: "general",
        requireApproved: true,
      },
    },
  },
  {
    id: "chat-06",
    suite: "chat",
    title: "Patch label change",
    harness: "chat",
    model: "default",
    input: {
      message: "Change the poem step label to Draft Poem.",
      manifestRef: "workflows/two-step-generate-chain.json",
    },
    assertions: {
      deterministic: [
        { kind: "invokeSuccess" },
        { kind: "classifiedIntent", value: "workflow-patch" },
        { kind: "validationValid" },
      ],
      judge: { enabled: false },
    },
  },
  {
    id: "chat-07",
    suite: "chat",
    title: "Identity question",
    harness: "chat",
    model: "default",
    input: { message: "What can you do?" },
    assertions: {
      deterministic: [
        { kind: "invokeSuccess" },
        { kind: "classifiedIntent", value: "general" },
        { kind: "replySchema" },
        { kind: "answerContains", text: "workflow" },
      ],
      judge: {
        enabled: true,
        goal: "States assistant capabilities",
        classifiedIntent: "general",
        requireApproved: true,
      },
    },
  },
  {
    id: "chat-08",
    suite: "chat",
    title: "Off-topic joke",
    harness: "chat",
    model: "default",
    input: { message: "Tell me a joke." },
    assertions: {
      deterministic: [
        { kind: "invokeSuccess" },
        { kind: "classifiedIntent", value: "general" },
        { kind: "classifiedTopic", contains: "off-topic" },
        { kind: "replySchema" },
        { kind: "answerRedirectsToScope" },
      ],
      judge: { ...offTopicJudge, classifiedIntent: "general" },
    },
  },
  {
    id: "chat-09",
    suite: "chat",
    title: "Run status assistant",
    harness: "chat",
    model: "default",
    input: {
      message: "What is the run status?",
      runContextFixture: "runs/failed-generate-step.json",
    },
    assertions: {
      deterministic: [
        { kind: "invokeSuccess" },
        { kind: "shotCount", value: 2 },
        { kind: "replySchema" },
        { kind: "answerContains", text: "fail" },
      ],
      judge: {
        enabled: true,
        goal: "Reports failed run status",
        rubric: "Mentions failed status from run context",
        requireApproved: true,
      },
    },
  },
]

writeSuite("workflow-create", creates)
writeSuite("workflow-patch", patches)
writeSuite("intent", intents)
writeSuite("assistant", assistants)
writeSuite("flow", flows)
writeSuite("chat", chatCases)
console.log(
  "Wrote",
  creates.length + patches.length + intents.length + assistants.length + flows.length + chatCases.length,
  "cases"
)
