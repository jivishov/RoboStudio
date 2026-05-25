export const ASSISTANT_MODELS = Object.freeze([
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    description: "Highest-capability page automation model.",
    reasoningEfforts: Object.freeze(["none", "low", "medium", "high", "xhigh"]),
    defaultReasoningEffort: "medium",
    reasoning: { effort: "medium" },
    requiresConfirmationGate: false
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    description: "Faster model for concise page actions.",
    reasoningEfforts: Object.freeze(["none", "low", "medium", "high", "xhigh"]),
    defaultReasoningEffort: "low",
    reasoning: { effort: "low" },
    requiresConfirmationGate: false
  }
]);

const MODEL_BY_ID = new Map(ASSISTANT_MODELS.map((model) => [model.id, model]));

export function getAssistantModel(modelId) {
  return MODEL_BY_ID.get(modelId) ?? null;
}

export function isSupportedAssistantModel(modelId) {
  return MODEL_BY_ID.has(modelId);
}

export function defaultAssistantModelId() {
  return ASSISTANT_MODELS[0].id;
}

export function reasoningEffortsForModel(modelId) {
  return getAssistantModel(modelId)?.reasoningEfforts ?? [];
}

export function defaultReasoningEffortForModel(modelId) {
  const model = getAssistantModel(modelId);
  return model?.defaultReasoningEffort ?? model?.reasoning?.effort ?? null;
}

export function isSupportedReasoningEffort(modelId, effort) {
  return reasoningEffortsForModel(modelId).includes(effort);
}
