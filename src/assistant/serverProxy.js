import {
  defaultReasoningEffortForModel,
  getAssistantModel,
  isSupportedAssistantModel,
  isSupportedReasoningEffort
} from "./modelCatalog.js";
import { ASSISTANT_PAGES, toolsForPage } from "./actionCatalog.js";

const PAGE_LABELS = Object.freeze({
  [ASSISTANT_PAGES.STUDIO]: "STL Assembly Studio",
  [ASSISTANT_PAGES.PARTS]: "Robotic Part Studio",
  [ASSISTANT_PAGES.WORKBENCH]: "Robotics Design Workbench"
});

const MAX_BODY_BYTES = 1_000_000;

function jsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function parseToolArguments(rawArguments) {
  if (!rawArguments) return {};
  if (typeof rawArguments === "object") return rawArguments;
  try {
    const parsed = JSON.parse(rawArguments);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return { __invalidJson: String(rawArguments) };
  }
}

function responseTextFromOutput(output = []) {
  const parts = [];
  for (const item of output) {
    if (item?.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content?.type === "output_text" && content.text) parts.push(content.text);
      if (content?.type === "text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function functionCallsFromOutput(output = []) {
  return output
    .filter((item) => item?.type === "function_call")
    .map((item) => ({
      callId: item.call_id,
      name: item.name,
      arguments: parseToolArguments(item.arguments),
      rawArguments: item.arguments ?? ""
    }));
}

export function extractAssistantResponse(openAiResponse) {
  return {
    responseId: openAiResponse.id,
    text: openAiResponse.output_text ?? responseTextFromOutput(openAiResponse.output),
    toolCalls: functionCallsFromOutput(openAiResponse.output),
    status: openAiResponse.status ?? null,
    usage: openAiResponse.usage ?? null
  };
}

export function buildAssistantInstructions(pageId) {
  const pageLabel = PAGE_LABELS[pageId] ?? pageId;
  return [
    `You are the in-page assistant for ${pageLabel}.`,
    "Help the user operate only the current page using the provided context and function tools.",
    "When the user asks to change settings, perform workflow steps, or inspect page state, call the best matching tool instead of giving manual click instructions.",
    "Use only registered tools. Do not invent action names, DOM selectors, local file paths, file hashes, vendor file IDs, or hidden runtime values.",
    "Destructive, save/export/import, navigation, file picker, and continuous-run actions may return a pending-confirmation result. If that happens, tell the user the action is waiting for confirmation in the assistant card.",
    "Keep final text concise and mention the concrete actions taken or queued."
  ].join("\n");
}

function userInputForPayload(payload) {
  const pageContext = JSON.stringify(payload.pageContext ?? {}, null, 2);
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: `Current page context:\n${pageContext}\n\nUser request:\n${payload.message}`
        }
      ]
    }
  ];
}

function toolOutputInputForPayload(payload) {
  return (payload.toolOutputs ?? []).map((item) => ({
    type: "function_call_output",
    call_id: item.callId,
    output: JSON.stringify(item.output ?? {})
  }));
}

export function buildResponsesRequest(payload) {
  if (!isSupportedAssistantModel(payload.model)) {
    throw new Error(`Unsupported assistant model: ${payload.model}`);
  }
  if (!PAGE_LABELS[payload.pageId]) {
    throw new Error(`Unsupported assistant page: ${payload.pageId}`);
  }
  const model = getAssistantModel(payload.model);
  const reasoningEffort = payload.reasoningEffort ?? defaultReasoningEffortForModel(model.id);
  if (!isSupportedReasoningEffort(model.id, reasoningEffort)) {
    throw new Error(`Unsupported reasoning effort ${reasoningEffort} for model ${model.id}`);
  }
  const toolOutputs = Array.isArray(payload.toolOutputs) ? payload.toolOutputs : [];
  const hasToolOutputs = toolOutputs.length > 0;
  const input = hasToolOutputs ? toolOutputInputForPayload({ ...payload, toolOutputs }) : userInputForPayload(payload);
  const request = {
    model: model.id,
    instructions: buildAssistantInstructions(payload.pageId),
    input,
    tools: toolsForPage(payload.pageId),
    parallel_tool_calls: false,
    max_output_tokens: 1800
  };
  request.reasoning = { ...(model.reasoning ?? {}), effort: reasoningEffort };
  if (payload.previousResponseId) request.previous_response_id = payload.previousResponseId;
  return request;
}

async function callOpenAiResponses({ apiKey, payload, fetchImpl = fetch }) {
  const requestBody = buildResponsesRequest(payload);
  const startedAt = Date.now();
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error: { message: text || "OpenAI returned a non-JSON response." } };
  }
  if (!response.ok) {
    const message = parsed?.error?.message ?? `OpenAI request failed with ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }
  return {
    ...extractAssistantResponse(parsed),
    latencyMs: Date.now() - startedAt
  };
}

export function createAssistantProxyMiddleware(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKeyProvider = options.apiKeyProvider ?? (() => process.env.OPENAI_API_KEY);
  return async function assistantProxy(req, res, next) {
    if (req.method !== "POST") {
      if (typeof next === "function") return next();
      jsonResponse(res, 405, { error: "Method not allowed." });
      return;
    }
    const apiKey = await apiKeyProvider();
    if (!apiKey) {
      jsonResponse(res, 503, {
        error: "OPENAI_API_KEY is not set for this local Vite server."
      });
      return;
    }
    try {
      const payload = await readJsonBody(req);
      const assistantResponse = await callOpenAiResponses({ apiKey, payload, fetchImpl });
      jsonResponse(res, 200, assistantResponse);
    } catch (error) {
      jsonResponse(res, error.statusCode ?? 400, {
        error: error.message ?? "Assistant request failed."
      });
    }
  };
}
