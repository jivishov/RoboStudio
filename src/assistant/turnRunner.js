import { ACTION_SAFETY, getActionDefinition, validateActionArguments } from "./actionCatalog.js";

export const MAX_ASSISTANT_TOOL_ROUNDS = 12;
export const MAX_ASSISTANT_NO_PROGRESS_ROUNDS = 2;

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const numeric = finiteNumber(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

export function summarizeAction(definition, args) {
  const details = Object.entries(args ?? {})
    .filter(([, value]) => value !== undefined && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join(" / ");
  return details ? `${definition.name} (${details})` : definition.name;
}

export function aggregateUsage(responses = []) {
  let usage = null;
  for (const response of responses) {
    usage = addUsageTotals(usage, response?.usage);
  }
  return usage;
}

export function normalizeUsage(usage) {
  if (!usage) return null;
  const input = firstFiniteNumber(usage.input_tokens, usage.prompt_tokens);
  const output = firstFiniteNumber(usage.output_tokens, usage.completion_tokens);
  const explicitTotal = finiteNumber(usage.total_tokens);
  if (input === null && output === null && explicitTotal === null) return null;
  return {
    input_tokens: input ?? 0,
    output_tokens: output ?? 0,
    total_tokens: explicitTotal ?? (input ?? 0) + (output ?? 0)
  };
}

export function addUsageTotals(currentUsage, addedUsage) {
  const current = normalizeUsage(currentUsage);
  const added = normalizeUsage(addedUsage);
  if (!current) return added;
  if (!added) return current;
  return {
    input_tokens: current.input_tokens + added.input_tokens,
    output_tokens: current.output_tokens + added.output_tokens,
    total_tokens: current.total_tokens + added.total_tokens
  };
}

export function aggregateLatency(responses = []) {
  const latencies = responses
    .map((response) => response?.latencyMs)
    .filter((latency) => Number.isFinite(latency));
  return latencies.length ? latencies.reduce((total, latency) => total + latency, 0) : null;
}

export async function postAssistantRequest(payload) {
  const response = await fetch("/api/assistant/respond", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(parsed.error ?? `Assistant request failed with ${response.status}`);
  }
  return parsed;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function toolRoundSignature(toolCalls = []) {
  return stableJson(
    toolCalls.map((toolCall) => ({
      name: toolCall.name,
      arguments: toolCall.arguments ?? {}
    }))
  );
}

function toolOutputMadeProgress(output) {
  if (!output || output.ok === false) return false;
  if (output.status === "pending_confirmation") return false;
  if (output.status === "no_change") return false;
  return true;
}

function pendingConfirmationOutput(definition, toolCall, args) {
  return {
    ok: false,
    action: toolCall.name,
    status: "pending_confirmation",
    message: definition.confirmation ?? summarizeAction(definition, args)
  };
}

async function resolveAssistantToolCall({ adapter, toolCall, onGuardedToolCall }) {
  const definition = getActionDefinition(adapter.pageId, toolCall.name);
  if (!definition) {
    return {
      callId: toolCall.callId,
      output: { ok: false, error: `Unknown action ${toolCall.name}` },
      definition: null,
      args: toolCall.arguments ?? {},
      guarded: false
    };
  }

  const args = toolCall.arguments ?? {};
  const validation = validateActionArguments(adapter.pageId, toolCall.name, args);
  if (!validation.ok) {
    return {
      callId: toolCall.callId,
      output: { ok: false, action: toolCall.name, error: validation.errors.join("; ") },
      definition,
      args,
      guarded: false
    };
  }

  if (definition.safety === ACTION_SAFETY.GUARDED) {
    const handled = await onGuardedToolCall?.({ toolCall, definition, args });
    return {
      callId: toolCall.callId,
      output: handled?.output ?? pendingConfirmationOutput(definition, toolCall, args),
      definition,
      args,
      guarded: true
    };
  }

  try {
    const result = await adapter.executeAction(toolCall.name, args);
    return {
      callId: toolCall.callId,
      output: result,
      definition,
      args,
      guarded: false
    };
  } catch (error) {
    const message = error.message ?? `${toolCall.name} failed.`;
    return {
      callId: toolCall.callId,
      output: { ok: false, action: toolCall.name, error: message },
      definition,
      args,
      guarded: false
    };
  }
}

export async function runAssistantTurn({
  adapter,
  model,
  reasoningEffort,
  message,
  previousResponseId = null,
  maxToolRounds = MAX_ASSISTANT_TOOL_ROUNDS,
  requestAssistant = postAssistantRequest,
  onResponse,
  onAssistantText,
  onToolCall,
  onToolResult,
  onGuardedToolCall
}) {
  const result = {
    previousResponseId,
    responses: [],
    toolCalls: [],
    guardedCalls: [],
    toolOutputs: [],
    finalText: "",
    stoppedForMaxRounds: false,
    stoppedForNoProgress: false,
    stoppedForGuardedConfirmation: false,
    stopReason: null,
    usage: null,
    latencyMs: null
  };
  let toolRoundCount = 0;
  let consecutiveNoProgressRounds = 0;
  let lastToolRoundSignature = null;

  let response = await requestAssistant({
    model,
    reasoningEffort,
    pageId: adapter.pageId,
    pageContext: adapter.getContext(),
    previousResponseId,
    message
  });

  async function ingestResponse(nextResponse, round) {
    result.responses.push(nextResponse);
    result.previousResponseId = nextResponse.responseId ?? result.previousResponseId;
    await onResponse?.(nextResponse, { round });
    if (nextResponse.text) {
      result.finalText = nextResponse.text;
      await onAssistantText?.(nextResponse.text, nextResponse, { round });
    }
  }

  for (let round = 0; ; round += 1) {
    result.responses.push(response);
    result.previousResponseId = response.responseId ?? result.previousResponseId;
    await onResponse?.(response, { round });
    if (response.text) {
      result.finalText = response.text;
      await onAssistantText?.(response.text, response, { round });
    }

    const toolCalls = response.toolCalls ?? [];
    if (!toolCalls.length) break;
    if (toolRoundCount >= maxToolRounds) {
      result.stoppedForMaxRounds = true;
      result.stopReason = "safety_budget";
      break;
    }

    const signature = toolRoundSignature(toolCalls);
    const repeatedNoProgressRound = signature === lastToolRoundSignature && consecutiveNoProgressRounds > 0;
    const toolOutputs = [];
    let guardedInRound = false;
    for (const toolCall of toolCalls) {
      const definition = getActionDefinition(adapter.pageId, toolCall.name);
      const callRecord = {
        callId: toolCall.callId,
        name: toolCall.name,
        arguments: toolCall.arguments ?? {},
        safety: definition?.safety ?? null
      };
      result.toolCalls.push(callRecord);
      await onToolCall?.(callRecord, toolCall, { round });

      const resolved = await resolveAssistantToolCall({ adapter, toolCall, onGuardedToolCall });
      if (resolved.guarded) {
        result.guardedCalls.push({
          callId: toolCall.callId,
          name: toolCall.name,
          arguments: resolved.args,
          message: resolved.output?.message ?? ""
        });
      }
      if (resolved.guarded) guardedInRound = true;
      result.toolOutputs.push(resolved);
      toolOutputs.push({ callId: resolved.callId, output: resolved.output });
      await onToolResult?.(resolved, toolCall, { round });
    }
    toolRoundCount += 1;

    const madeProgress = toolOutputs.some((item) => toolOutputMadeProgress(item.output));
    consecutiveNoProgressRounds = madeProgress ? 0 : consecutiveNoProgressRounds + 1;
    lastToolRoundSignature = signature;
    if (repeatedNoProgressRound || consecutiveNoProgressRounds >= MAX_ASSISTANT_NO_PROGRESS_ROUNDS) {
      result.stoppedForNoProgress = true;
      result.stopReason = "no_progress";
      break;
    }

    response = await requestAssistant({
      model,
      reasoningEffort,
      pageId: adapter.pageId,
      pageContext: adapter.getContext(),
      previousResponseId: response.responseId,
      toolOutputs
    });
    if (guardedInRound) {
      result.stoppedForGuardedConfirmation = true;
      result.stopReason = "guarded_confirmation";
      await ingestResponse(response, round + 1);
      break;
    }
  }

  result.usage = aggregateUsage(result.responses);
  result.latencyMs = aggregateLatency(result.responses);
  return result;
}
