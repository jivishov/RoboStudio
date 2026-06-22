import {
  defaultReasoningEffortForModel,
  getAssistantModel,
  isSupportedAssistantModel,
  isSupportedReasoningEffort
} from "./modelCatalog.js";
import { ASSISTANT_PAGES, toolsForPage } from "./actionCatalog.js";
import {
  MAX_ASSISTANT_UPLOAD_BODY_BYTES,
  createAssistantAttachmentStore,
  decodeUploadFiles
} from "./attachments.js";

const PAGE_LABELS = Object.freeze({
  [ASSISTANT_PAGES.STUDIO]: "STL Assembly Studio",
  [ASSISTANT_PAGES.PARTS]: "Robotic Component Builder",
  [ASSISTANT_PAGES.WORKBENCH]: "Robotics Design Workbench",
  [ASSISTANT_PAGES.ELECTRONICS]: "Electronics Studio",
  [ASSISTANT_PAGES.CIRCUITS]: "Circuit Lab"
});

const PAGE_INSTRUCTIONS = Object.freeze({
  [ASSISTANT_PAGES.PARTS]: [
    "For Component Builder requests, use starter templates when they clearly match the requested object.",
    "If no template matches, design a custom sketch-extrude body with the supported V1 profile types: rectangle, circle, roundedSlot, and closed polyline.",
    "For STEP-oriented mechanical CAD that needs advanced operations, use a declarative advanced CAD recipe with registered recipe actions; never emit raw Python, local paths, temp paths, file hashes, or backend identifiers.",
    "Prefer one coherent custom body. Use multiple bodies only when the user clearly asks for separate physical parts.",
    "After custom creation or replacement, inspect validation and build status from tool output or page context. Refine with parts_replace_sketch_body when validation or build feedback shows a fixable geometry problem.",
    "If the requested shape needs unsupported freeform surfaces, helical sweeps, or true 3D blades, create the closest valid sketch-extrude approximation and state the limitation briefly."
  ],
  [ASSISTANT_PAGES.ELECTRONICS]: [
    "For electronics requests, keep changes inside CircuitDesign state on the Electronics Studio page.",
    "Prefer safe GPIO suggestions before connecting LEDs, buttons, or other starter components to ESP32-family board pins.",
    "Run electronics DRC after wiring changes and mention blocking errors before export.",
    "Generate ESP-IDF source files from the registered code generation tool; do not claim that firmware was built, flashed, or simulated on hardware."
  ],
  [ASSISTANT_PAGES.CIRCUITS]: [
    "For Circuit Lab requests, keep changes inside the new CircuitLabProject state and do not use Circuitiny concepts, imports, or implementation details.",
    "Use registered Circuit Lab tools to add hardware, apply starter templates, connect terminals, run tests, and generate source.",
    "Run the Circuit Lab test after wiring changes and report blocking power, ground, polarity, or actuator-supply errors before source generation.",
    "Generated files are source-only. Do not claim that firmware was built, flashed, simulated natively, or tested on hardware."
  ]
});

const MAX_BODY_BYTES = 1_000_000;

function jsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
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
    ...(PAGE_INSTRUCTIONS[pageId] ?? []),
    "Keep final text concise and mention the concrete actions taken or queued."
  ].join("\n");
}

function fileInputsForPayload(payload) {
  const fileInputs = Array.isArray(payload.fileInputs) ? payload.fileInputs : [];
  return fileInputs.map((fileInput) => {
    if (!fileInput || typeof fileInput.fileId !== "string" || !fileInput.fileId) {
      throw new Error("Invalid assistant file input.");
    }
    return {
      fileId: fileInput.fileId,
      name: typeof fileInput.name === "string" ? fileInput.name : "",
      inputKind: fileInput.inputKind === "image" ? "image" : "file"
    };
  });
}

function attachedFilesText(fileInputs) {
  const names = fileInputs.map((fileInput) => fileInput.name).filter(Boolean);
  return names.length ? `Attached files: ${names.join(", ")}\n\n` : "";
}

function userInputForPayload(payload) {
  const pageContext = JSON.stringify(payload.pageContext ?? {}, null, 2);
  const fileInputs = fileInputsForPayload(payload);
  return [
    {
      role: "user",
      content: [
        ...fileInputs.map((fileInput) =>
          fileInput.inputKind === "image"
            ? {
                type: "input_image",
                file_id: fileInput.fileId,
                detail: "auto"
              }
            : {
                type: "input_file",
                file_id: fileInput.fileId
              }
        ),
        {
          type: "input_text",
          text: `${attachedFilesText(fileInputs)}Current page context:\n${pageContext}\n\nUser request:\n${payload.message}`
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
    parallel_tool_calls: false
  };
  request.reasoning = { ...(model.reasoning ?? {}), effort: reasoningEffort };
  if (payload.previousResponseId) request.previous_response_id = payload.previousResponseId;
  return request;
}

async function resolveAttachmentFileInputs({ apiKey, payload, attachmentStore, fetchImpl }) {
  const attachmentIds = Array.isArray(payload.attachmentIds) ? payload.attachmentIds : [];
  const hasToolOutputs = Array.isArray(payload.toolOutputs) && payload.toolOutputs.length > 0;
  if (!attachmentIds.length || hasToolOutputs) return [];
  return attachmentStore.openAiFileInputsForIds(attachmentIds, { apiKey, fetchImpl });
}

async function callOpenAiResponses({ apiKey, payload, attachmentStore, fetchImpl = fetch }) {
  const fileInputs = await resolveAttachmentFileInputs({ apiKey, payload, attachmentStore, fetchImpl });
  const requestBody = buildResponsesRequest({ ...payload, fileInputs });
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
  const attachmentStore = options.attachmentStore ?? createAssistantAttachmentStore();
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
      const assistantResponse = await callOpenAiResponses({ apiKey, payload, attachmentStore, fetchImpl });
      jsonResponse(res, 200, assistantResponse);
    } catch (error) {
      jsonResponse(res, error.statusCode ?? 400, {
        error: error.message ?? "Assistant request failed."
      });
    }
  };
}

export function createAssistantAttachmentsMiddleware(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKeyProvider = options.apiKeyProvider ?? (() => process.env.OPENAI_API_KEY);
  const attachmentStore = options.attachmentStore ?? createAssistantAttachmentStore();

  return async function assistantAttachments(req, res, next) {
    if (req.method !== "POST" && req.method !== "DELETE") {
      if (typeof next === "function") return next();
      jsonResponse(res, 405, { error: "Method not allowed." });
      return;
    }

    try {
      if (req.method === "POST") {
        const payload = await readJsonBody(req, MAX_ASSISTANT_UPLOAD_BODY_BYTES);
        const files = decodeUploadFiles(payload);
        const attachments = [];
        for (const file of files) {
          attachments.push(await attachmentStore.stageFile(file));
        }
        jsonResponse(res, 200, { attachments });
        return;
      }

      const payload = await readJsonBody(req);
      const attachmentIds = Array.isArray(payload.attachmentIds) ? payload.attachmentIds : [];
      const apiKey = await apiKeyProvider();
      const result = await attachmentStore.cleanupAttachmentIds(attachmentIds, { apiKey, fetchImpl });
      jsonResponse(res, 200, { ok: true, ...result });
    } catch (error) {
      jsonResponse(res, error.statusCode ?? 400, {
        error: error.message ?? "Assistant attachment request failed."
      });
    }
  };
}
