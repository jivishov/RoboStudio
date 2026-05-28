const SHORT_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit"
});

const SAME_YEAR_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric"
});

const OTHER_YEAR_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric"
});

const FULL_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short"
});

function asValidDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameLocalDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function previousLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function labelForAssistantMessageRole(role) {
  if (role === "user") return "You";
  if (role === "action") return "Action";
  return "Assistant";
}

export function formatAssistantMessageTimestamp(value, nowValue = new Date()) {
  const date = asValidDate(value);
  const now = asValidDate(nowValue) ?? new Date();
  if (!date) return "";

  const time = SHORT_TIME_FORMATTER.format(date);
  if (isSameLocalDay(date, now)) return `Today, ${time}`;
  if (isSameLocalDay(date, previousLocalDay(now))) return `Yesterday, ${time}`;

  const dateFormatter =
    date.getFullYear() === now.getFullYear() ? SAME_YEAR_DATE_FORMATTER : OTHER_YEAR_DATE_FORMATTER;
  return `${dateFormatter.format(date)}, ${time}`;
}

export function formatAssistantMessageFullTimestamp(value) {
  const date = asValidDate(value);
  return date ? FULL_TIMESTAMP_FORMATTER.format(date) : "Unknown time";
}

export function buildAssistantConversationTranscript({
  title = "Assistant conversation",
  messages = [],
  savedAt = new Date()
} = {}) {
  const lines = [
    title,
    `Saved ${formatAssistantMessageFullTimestamp(savedAt)}`,
    `Messages: ${messages.length}`,
    ""
  ];

  if (!messages.length) {
    lines.push("No messages yet.");
    return `${lines.join("\n")}\n`;
  }

  for (const message of messages) {
    const label = message.label ?? labelForAssistantMessageRole(message.role);
    lines.push(`[${formatAssistantMessageFullTimestamp(message.createdAt)}] ${label}`);
    lines.push(String(message.text ?? ""));
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function assistantConversationFileName(title = "assistant", savedAt = new Date()) {
  const date = asValidDate(savedAt) ?? new Date();
  const slug =
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "assistant";
  const stamp = [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("-");
  const time = [pad2(date.getHours()), pad2(date.getMinutes()), pad2(date.getSeconds())].join("-");
  return `${slug}-conversation-${stamp}-${time}.txt`;
}
