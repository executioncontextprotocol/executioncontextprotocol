import { EVAL_SUITE_VALUES } from "@executioncontrolprotocol/evals"
import { describeCodingAnthropicMatrix } from "./helpers/coding-anthropic-matrix.js"

describeCodingAnthropicMatrix(EVAL_SUITE_VALUES.WORKFLOW_CREATE, "workflow-create")
