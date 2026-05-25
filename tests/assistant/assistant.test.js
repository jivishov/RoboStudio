import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  ACTION_SAFETY,
  ASSISTANT_PAGES,
  getActionDefinition,
  getActionsForPage,
  toolsForPage,
  validateActionArguments
} from "../../src/assistant/actionCatalog.js";
import {
  ASSISTANT_MODELS,
  defaultAssistantModelId,
  defaultReasoningEffortForModel,
  getAssistantModel,
  isSupportedAssistantModel,
  isSupportedReasoningEffort,
  reasoningEffortsForModel
} from "../../src/assistant/modelCatalog.js";
import { createPageAssistantAdapter } from "../../src/assistant/pageAdapter.js";
import {
  buildResponsesRequest,
  createAssistantProxyMiddleware,
  extractAssistantResponse
} from "../../src/assistant/serverProxy.js";
import { formatResponseMetrics } from "../../src/assistant/metrics.js";
import { clampAssistantPosition } from "../../src/assistant/drag.js";
import {
  ASSISTANT_EVAL_MODEL,
  ASSISTANT_EVAL_REASONING_EFFORT,
  evaluateScenarioResult,
  getAssistantEvalScenarios,
  requiredCallsMissing
} from "../../src/assistant/evalScenarios.js";
import {
  MAX_ASSISTANT_TOOL_ROUNDS,
  addUsageTotals,
  aggregateUsage,
  normalizeUsage,
  runAssistantTurn
} from "../../src/assistant/turnRunner.js";

test("assistant model catalog exposes only requested model ids", () => {
  assert.deepEqual(
    ASSISTANT_MODELS.map((model) => model.id),
    ["gpt-5.5", "gpt-5.4-mini"]
  );
  assert.equal(defaultAssistantModelId(), "gpt-5.5");
  assert.equal(isSupportedAssistantModel("gpt-5.5"), true);
  assert.equal(isSupportedAssistantModel("gpt-5.4-mini"), true);
  assert.equal(isSupportedAssistantModel("gpt-4o-mini"), false);
  assert.equal(getAssistantModel("gpt-5.4-mini").reasoning.effort, "low");
  assert.deepEqual(reasoningEffortsForModel("gpt-5.5"), ["none", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(reasoningEffortsForModel("gpt-5.4-mini"), ["none", "low", "medium", "high", "xhigh"]);
  assert.equal(defaultReasoningEffortForModel("gpt-5.5"), "medium");
  assert.equal(defaultReasoningEffortForModel("gpt-5.4-mini"), "low");
  assert.equal(isSupportedReasoningEffort("gpt-5.4-mini", "xhigh"), true);
  assert.equal(isSupportedReasoningEffort("gpt-5.4-mini", "minimal"), false);
});

test("action registry separates safe and guarded page actions", () => {
  const studioActions = getActionsForPage(ASSISTANT_PAGES.STUDIO);
  const workbenchActions = getActionsForPage(ASSISTANT_PAGES.WORKBENCH);

  assert.ok(studioActions.some((action) => action.name === "studio_set_mode"));
  assert.ok(studioActions.some((action) => action.name === "studio_export_glb"));
  assert.ok(workbenchActions.some((action) => action.name === "workbench_step_simulation"));
  assert.ok(workbenchActions.some((action) => action.name === "workbench_delete_proxy"));

  assert.equal(getActionDefinition(ASSISTANT_PAGES.STUDIO, "studio_set_mode").safety, ACTION_SAFETY.AUTO);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.STUDIO, "studio_export_glb").safety, ACTION_SAFETY.GUARDED);
  assert.equal(getActionDefinition(ASSISTANT_PAGES.WORKBENCH, "workbench_delete_proxy").safety, ACTION_SAFETY.GUARDED);
});

test("action argument validation rejects unknown, unsafe, and malformed input", () => {
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.STUDIO, "studio_set_mode", { mode: "hinge" }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.STUDIO, "studio_set_mode", { mode: "delete" }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.STUDIO, "studio_set_grid_visible", { visible: "yes" }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.WORKBENCH, "workbench_set_ik_target", { target: [1, 2, 3] }).ok,
    true
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.WORKBENCH, "workbench_set_ik_target", { target: [1, 2] }).ok,
    false
  );
  assert.equal(
    validateActionArguments(ASSISTANT_PAGES.WORKBENCH, "workbench_unknown", {}).ok,
    false
  );
});

test("tool schemas are generated from the central action registry", () => {
  const tools = toolsForPage(ASSISTANT_PAGES.STUDIO);
  const setMode = tools.find((tool) => tool.name === "studio_set_mode");

  assert.ok(setMode);
  assert.equal(setMode.type, "function");
  assert.deepEqual(setMode.parameters.properties.mode.enum, ["select", "move", "rotate", "hinge"]);
  assert.equal(tools.some((tool) => tool.name === "workbench_set_mode"), false);
});

test("Responses request builder uses model catalog, tools, previous response id, and tool outputs", () => {
  const firstTurn = buildResponsesRequest({
    model: "gpt-5.5",
    pageId: ASSISTANT_PAGES.STUDIO,
    pageContext: { mode: "hinge" },
    previousResponseId: "resp_previous",
    reasoningEffort: "high",
    message: "Set the elbow to 30 degrees"
  });

  assert.equal(firstTurn.model, "gpt-5.5");
  assert.equal(firstTurn.previous_response_id, "resp_previous");
  assert.equal(firstTurn.parallel_tool_calls, false);
  assert.equal(firstTurn.reasoning.effort, "high");
  assert.ok(firstTurn.tools.some((tool) => tool.name === "studio_set_joint_angle"));
  assert.match(firstTurn.input[0].content[0].text, /Current page context/);

  const toolTurn = buildResponsesRequest({
    model: "gpt-5.4-mini",
    pageId: ASSISTANT_PAGES.WORKBENCH,
    previousResponseId: "resp_tools",
    reasoningEffort: "low",
    toolOutputs: [{ callId: "call_1", output: { ok: true, message: "Done" } }]
  });

  assert.equal(toolTurn.model, "gpt-5.4-mini");
  assert.equal(toolTurn.previous_response_id, "resp_tools");
  assert.equal(toolTurn.input[0].type, "function_call_output");
  assert.equal(toolTurn.input[0].call_id, "call_1");
  assert.ok(toolTurn.tools.some((tool) => tool.name === "workbench_step_simulation"));
});

test("Responses request builder rejects unsupported models, pages, and efforts", () => {
  assert.throws(
    () => buildResponsesRequest({ model: "gpt-4o-mini", pageId: ASSISTANT_PAGES.STUDIO, message: "hi" }),
    /Unsupported assistant model/
  );
  assert.throws(
    () => buildResponsesRequest({ model: "gpt-5.5", pageId: "other", message: "hi" }),
    /Unsupported assistant page/
  );
  assert.throws(
    () =>
      buildResponsesRequest({
        model: "gpt-5.5",
        pageId: ASSISTANT_PAGES.STUDIO,
        reasoningEffort: "minimal",
        message: "hi"
      }),
    /Unsupported reasoning effort/
  );
});

test("assistant response extraction handles text and function calls", () => {
  const extracted = extractAssistantResponse({
    id: "resp_123",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "I will update it." }]
      },
      {
        type: "function_call",
        call_id: "call_abc",
        name: "studio_set_mode",
        arguments: "{\"mode\":\"move\"}"
      }
    ]
  });

  assert.equal(extracted.responseId, "resp_123");
  assert.equal(extracted.text, "I will update it.");
  assert.equal(extracted.usage, null);
  assert.deepEqual(extracted.toolCalls, [
    { callId: "call_abc", name: "studio_set_mode", arguments: { mode: "move" }, rawArguments: "{\"mode\":\"move\"}" }
  ]);
});

test("page assistant adapter validates and executes registered actions", async () => {
  const calls = [];
  const adapter = createPageAssistantAdapter({
    pageId: ASSISTANT_PAGES.STUDIO,
    title: "Test Studio",
    getContext: () => ({ mode: "hinge" }),
    actions: {
      studio_set_mode: async (args) => {
        calls.push(args);
        return "mode updated";
      }
    }
  });

  assert.deepEqual(adapter.getContext(), { mode: "hinge" });
  assert.deepEqual(await adapter.executeAction("studio_set_mode", { mode: "move" }), {
    ok: true,
    action: "studio_set_mode",
    message: "mode updated",
    data: undefined
  });
  assert.deepEqual(calls, [{ mode: "move" }]);
  await assert.rejects(() => adapter.executeAction("studio_set_mode", { mode: "bad" }), /must be one of/);
  await assert.rejects(() => adapter.executeAction("studio_export_glb", {}), /No page handler/);
});

test("assistant proxy uses injected api key provider and returns usage plus latency", async () => {
  const req = new PassThrough();
  req.method = "POST";

  const responsePromise = new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      end(content) {
        resolve({ statusCode: this.statusCode, headers: this.headers, content });
      }
    };

    const middleware = createAssistantProxyMiddleware({
      apiKeyProvider: () => "fake-test-key",
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://api.openai.com/v1/responses");
        assert.equal(options.headers.authorization, "Bearer fake-test-key");
        const body = JSON.parse(options.body);
        assert.equal(body.model, "gpt-5.4-mini");
        assert.equal(body.reasoning.effort, "low");
        return new Response(
          JSON.stringify({
            id: "resp_test",
            status: "completed",
            output_text: "Connected.",
            output: [],
            usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });
    middleware(req, res);
  });

  req.end(
    JSON.stringify({
      model: "gpt-5.4-mini",
      reasoningEffort: "low",
      pageId: ASSISTANT_PAGES.STUDIO,
      pageContext: {},
      message: "hello"
    })
  );

  const response = await responsePromise;
  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.content);
  assert.equal(parsed.responseId, "resp_test");
  assert.equal(parsed.text, "Connected.");
  assert.equal(parsed.usage.total_tokens, 13);
  assert.equal(Number.isFinite(parsed.latencyMs), true);
});

test("assistant usage helpers normalize response and conversation token totals", () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 4, completion_tokens: 6 }), {
    input_tokens: 4,
    output_tokens: 6,
    total_tokens: 10
  });
  assert.deepEqual(
    aggregateUsage([
      { usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } },
      { usage: { prompt_tokens: 4, completion_tokens: 6 } },
      { usage: null }
    ]),
    { input_tokens: 14, output_tokens: 9, total_tokens: 23 }
  );
  assert.deepEqual(
    addUsageTotals(
      { input_tokens: 14, output_tokens: 9, total_tokens: 23 },
      { input_tokens: 5, output_tokens: 2, total_tokens: 7 }
    ),
    { input_tokens: 19, output_tokens: 11, total_tokens: 30 }
  );
  assert.equal(aggregateUsage([{ usage: {} }]), null);
  assert.equal(
    formatResponseMetrics(
      { latencyMs: 125, usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } },
      { input_tokens: 19, output_tokens: 11, total_tokens: 30 }
    ),
    "Last response: 125 ms / 7 tokens | Conversation total: 30 tokens"
  );
});

test("assistant drag clamp keeps card inside viewport", () => {
  assert.deepEqual(
    clampAssistantPosition({ x: -200, y: -50 }, { width: 900, height: 600 }, { width: 300, height: 220 }),
    { x: 10, y: 10 }
  );
  assert.deepEqual(
    clampAssistantPosition({ x: 850, y: 580 }, { width: 900, height: 600 }, { width: 300, height: 220 }),
    { x: 590, y: 370 }
  );
  assert.deepEqual(
    clampAssistantPosition({ x: 250, y: 180 }, { width: 900, height: 600 }, { width: 300, height: 220 }),
    { x: 250, y: 180 }
  );
});

test("assistant eval scenarios use mini model with high reasoning and validate state", () => {
  assert.equal(ASSISTANT_EVAL_MODEL, "gpt-5.4-mini");
  assert.equal(ASSISTANT_EVAL_REASONING_EFFORT, "high");
  assert.equal(MAX_ASSISTANT_TOOL_ROUNDS, 6);

  const studioScenarios = getAssistantEvalScenarios(ASSISTANT_PAGES.STUDIO);
  const partSetup = studioScenarios.find((scenario) => scenario.id === "studio-part-setup");
  assert.ok(partSetup);
  assert.deepEqual(partSetup.requiredCalls, [
    "studio_set_mode",
    "studio_search_parts",
    "studio_select_part",
    "studio_set_part_opacity"
  ]);

  assert.deepEqual(requiredCallsMissing(
    [{ name: "studio_set_mode" }, { name: "studio_search_parts" }],
    ["studio_set_mode", "studio_select_part"]
  ), ["studio_select_part"]);

  const summary = evaluateScenarioResult(
    partSetup,
    {
      toolCalls: partSetup.requiredCalls.map((name) => ({ name })),
      guardedCalls: [],
      stoppedForMaxRounds: false,
      latencyMs: 500,
      usage: { total_tokens: 100 },
      finalText: "Done."
    },
    {
      mode: "rotate",
      search: "upper",
      selection: { id: "upper_arm", opacityPercent: 55 }
    }
  );
  assert.equal(summary.pass, true);
  assert.equal(summary.usage.total_tokens, 100);
});

test("assistant turn runner stages guarded actions without executing them", async () => {
  let executed = false;
  const payloads = [];
  const adapter = createPageAssistantAdapter({
    pageId: ASSISTANT_PAGES.STUDIO,
    title: "Test Studio",
    getContext: () => ({ ready: true }),
    actions: {
      studio_export_glb: () => {
        executed = true;
      }
    }
  });

  const result = await runAssistantTurn({
    adapter,
    model: ASSISTANT_EVAL_MODEL,
    reasoningEffort: ASSISTANT_EVAL_REASONING_EFFORT,
    message: "Export the GLB.",
    requestAssistant: async (payload) => {
      payloads.push(payload);
      if (payload.message) {
        return {
          responseId: "resp_guarded",
          text: "",
          toolCalls: [{ callId: "call_export", name: "studio_export_glb", arguments: {} }]
        };
      }
      return { responseId: "resp_final", text: "Queued.", toolCalls: [], usage: { total_tokens: 12 } };
    }
  });

  assert.equal(executed, false);
  assert.equal(payloads[0].reasoningEffort, "high");
  assert.equal(payloads[1].toolOutputs[0].output.status, "pending_confirmation");
  assert.deepEqual(result.guardedCalls.map((call) => call.name), ["studio_export_glb"]);
  assert.equal(result.finalText, "Queued.");
});

test("assistant turn runner enforces shared tool-round limit", async () => {
  let requestCount = 0;
  const adapter = createPageAssistantAdapter({
    pageId: ASSISTANT_PAGES.STUDIO,
    title: "Test Studio",
    getContext: () => ({ ready: true }),
    actions: {
      studio_set_mode: ({ mode }) => `Mode set to ${mode}.`
    }
  });

  const result = await runAssistantTurn({
    adapter,
    model: "gpt-5.4-mini",
    reasoningEffort: "high",
    message: "Keep changing mode.",
    maxToolRounds: 2,
    requestAssistant: async () => {
      requestCount += 1;
      return {
        responseId: `resp_${requestCount}`,
        text: "",
        toolCalls: [{ callId: `call_${requestCount}`, name: "studio_set_mode", arguments: { mode: "move" } }]
      };
    }
  });

  assert.equal(result.stoppedForMaxRounds, true);
  assert.equal(result.toolCalls.length, 2);
  assert.equal(requestCount, 3);
});
