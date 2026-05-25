import { normalizeUsage } from "./turnRunner.js";

function formatTokenCount(value) {
  return Math.round(value).toLocaleString("en-US");
}

export function formatUsageTokens(usage) {
  const normalized = normalizeUsage(usage);
  return normalized ? `${formatTokenCount(normalized.total_tokens)} tokens` : "";
}

export function formatResponseMetrics(response, conversationUsage = null) {
  const segments = [];
  if (Number.isFinite(response?.latencyMs)) segments.push(`${response.latencyMs} ms`);
  const responseTokens = formatUsageTokens(response?.usage);
  if (responseTokens) segments.push(responseTokens);
  const lastResponse = segments.length ? `Last response: ${segments.join(" / ")}` : "";
  const conversationTokens = formatUsageTokens(conversationUsage);
  if (!conversationTokens) return lastResponse;
  return `${lastResponse || "Last response: n/a"} | Conversation total: ${conversationTokens}`;
}
