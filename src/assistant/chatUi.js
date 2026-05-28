import "./assistant.css";
import {
  ASSISTANT_MODELS,
  defaultAssistantModelId,
  defaultReasoningEffortForModel,
  getAssistantModel,
  reasoningEffortsForModel
} from "./modelCatalog.js";
import { createPageAssistantAdapter } from "./pageAdapter.js";
import { clampAssistantPosition, isAssistantDragBlocked } from "./drag.js";
import { formatResponseMetrics } from "./metrics.js";
import { addUsageTotals, runAssistantTurn, summarizeAction } from "./turnRunner.js";
import {
  assistantConversationFileName,
  buildAssistantConversationTranscript,
  formatAssistantMessageTimestamp,
  labelForAssistantMessageRole
} from "./conversationTranscript.js";

function createElement(tag, className, text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function modelOptionsHtml() {
  return ASSISTANT_MODELS.map((model) => `<option value="${model.id}">${model.label}</option>`).join("");
}

function reasoningOptionsHtml(modelId, selectedEffort = defaultReasoningEffortForModel(modelId)) {
  return reasoningEffortsForModel(modelId)
    .map((effort) => `<option value="${effort}" ${effort === selectedEffort ? "selected" : ""}>${effort}</option>`)
    .join("");
}

function materialIcon(name) {
  return `<span class="material-symbols-rounded app-icon" aria-hidden="true">${name}</span>`;
}

function createMaterialIcon(name, className = "") {
  const icon = createElement("span", `material-symbols-rounded app-icon ${className}`.trim(), name);
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function createIconButton(className, label, iconName) {
  const button = createElement("button", className);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = materialIcon(iconName);
  return button;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy failed.");
}

function downloadTextFile(fileName, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function mountPageAssistant(config) {
  const adapter = createPageAssistantAdapter(config);
  const root = createElement("section", "assistant-card");
  root.setAttribute("aria-label", `${adapter.title ?? "Page"} assistant`);
  const initialModelId = defaultAssistantModelId();
  root.innerHTML = `
    <div class="assistant-card__header">
      <button class="assistant-card__collapse" type="button" aria-expanded="true" aria-controls="assistant-card-body">
        <span class="assistant-card__title-group">
          <span class="material-symbols-rounded app-icon assistant-card__ai-icon" aria-hidden="true">smart_toy</span>
          <span class="assistant-card__title">Assistant</span>
        </span>
        <span class="assistant-card__chevron" aria-hidden="true"></span>
      </button>
      <div class="assistant-card__tools" data-assistant-no-drag>
        <button class="assistant-card__icon-button" type="button" title="Reset conversation" aria-label="Reset conversation" data-assistant-reset>
          ${materialIcon("restart_alt")}
        </button>
        <button class="assistant-card__icon-button" type="button" title="Save conversation" aria-label="Save conversation" data-assistant-save>
          ${materialIcon("save")}
        </button>
        <div class="assistant-card__controls">
          <label class="assistant-card__field">
            <span>Model</span>
            <select data-assistant-model>${modelOptionsHtml()}</select>
          </label>
          <label class="assistant-card__field">
            <span>Reasoning</span>
            <select data-assistant-reasoning>${reasoningOptionsHtml(initialModelId)}</select>
          </label>
        </div>
      </div>
    </div>
    <div class="assistant-card__body" id="assistant-card-body">
      <div class="assistant-card__messages" aria-live="polite"></div>
      <div class="assistant-card__confirmations"></div>
      <form class="assistant-card__form">
        <textarea rows="3" placeholder="Ask the assistant to operate this page..."></textarea>
        <button type="submit">Send</button>
      </form>
      <p class="assistant-card__status" role="status"></p>
    </div>
  `;

  const headerEl = root.querySelector(".assistant-card__header");
  const modelSelect = root.querySelector("[data-assistant-model]");
  const reasoningSelect = root.querySelector("[data-assistant-reasoning]");
  const resetButton = root.querySelector("[data-assistant-reset]");
  const saveButton = root.querySelector("[data-assistant-save]");
  const collapseButton = root.querySelector(".assistant-card__collapse");
  const messagesEl = root.querySelector(".assistant-card__messages");
  const confirmationsEl = root.querySelector(".assistant-card__confirmations");
  const form = root.querySelector(".assistant-card__form");
  const input = root.querySelector("textarea");
  const sendButton = root.querySelector("button[type='submit']");
  const statusEl = root.querySelector(".assistant-card__status");

  modelSelect.value = initialModelId;
  reasoningSelect.value = defaultReasoningEffortForModel(initialModelId);

  const state = {
    previousResponseId: null,
    busy: false,
    confirmations: [],
    position: null,
    drag: null,
    lastMetrics: "",
    conversationUsage: null,
    messages: [],
    nextMessageId: 1
  };

  function setBusy(busy, message = "") {
    state.busy = busy;
    sendButton.disabled = busy;
    resetButton.disabled = busy;
    modelSelect.disabled = busy;
    reasoningSelect.disabled = busy;
    statusEl.textContent = message || (!busy ? state.lastMetrics : "");
    root.classList.toggle("is-busy", busy);
  }

  function setLastMetrics(response) {
    state.conversationUsage = addUsageTotals(state.conversationUsage, response?.usage);
    state.lastMetrics = formatResponseMetrics(response, state.conversationUsage);
    if (!state.busy && state.lastMetrics) statusEl.textContent = state.lastMetrics;
  }

  function appendMessage(role, text) {
    const createdAt = new Date();
    const labelText = labelForAssistantMessageRole(role);
    const message = {
      id: `assistant-message-${state.nextMessageId}`,
      role,
      label: labelText,
      text: String(text ?? ""),
      createdAt
    };
    state.nextMessageId += 1;
    state.messages.push(message);

    const item = createElement("article", `assistant-message assistant-message--${role}`);
    item.setAttribute("data-message-id", message.id);
    const header = createElement("div", "assistant-message__header");
    const label = createElement("span", "assistant-message__role");
    if (role === "user" || role === "assistant") {
      label.append(
        createMaterialIcon(role === "user" ? "person" : "smart_toy", "assistant-message__role-icon"),
        document.createTextNode(labelText)
      );
    } else {
      label.textContent = labelText;
    }
    const time = createElement("time", "assistant-message__time", formatAssistantMessageTimestamp(createdAt));
    const copy = createIconButton("assistant-message__copy", `Copy ${labelText.toLowerCase()} message`, "content_copy");
    time.dateTime = createdAt.toISOString();
    time.title = createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    copy.addEventListener("click", async () => {
      try {
        await copyTextToClipboard(message.text);
        statusEl.textContent = "Copied message text.";
      } catch (error) {
        statusEl.textContent = error.message ?? "Copy failed.";
      }
    });
    const body = createElement("p", "assistant-message__text", message.text);
    header.append(label, time, copy);
    item.append(header, body);
    messagesEl.append(item);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function saveConversation() {
    const savedAt = new Date();
    const title = `${adapter.title ?? "Page"} assistant conversation`;
    const transcript = buildAssistantConversationTranscript({
      title,
      messages: state.messages,
      savedAt
    });
    const fileName = assistantConversationFileName(adapter.title ?? "assistant", savedAt);
    downloadTextFile(fileName, transcript);
    statusEl.textContent = `Saved ${fileName}.`;
  }

  function resetConversation() {
    if (state.busy) return;
    state.previousResponseId = null;
    state.confirmations = [];
    state.lastMetrics = "";
    state.conversationUsage = null;
    state.messages = [];
    state.nextMessageId = 1;
    input.value = "";
    messagesEl.replaceChildren();
    renderConfirmations();
    statusEl.textContent = "Conversation reset. Start a new request when ready.";
  }

  function assistantStopMessage(result) {
    if (result.stopReason === "guarded_confirmation") {
      return result.finalText ? "" : "Waiting for confirmation before continuing guarded work.";
    }
    if (result.stopReason === "no_progress") {
      return "The assistant stopped because the last actions did not make progress. Check the action result above for the blocking validation or tool error.";
    }
    if (result.stopReason === "safety_budget") {
      return "The assistant reached the safe automatic action budget before the task fully settled. Review the current page state before continuing.";
    }
    return "";
  }

  function renderConfirmations() {
    confirmationsEl.replaceChildren();
    for (const confirmation of state.confirmations) {
      const card = createElement("article", "assistant-confirmation");
      const body = createElement("p", "", confirmation.label);
      const actions = createElement("div", "assistant-confirmation__actions");
      const confirm = createElement("button", "", "Confirm");
      const cancel = createElement("button", "", "Cancel");
      confirm.type = "button";
      cancel.type = "button";
      confirm.addEventListener("click", async () => {
        state.confirmations = state.confirmations.filter((item) => item.id !== confirmation.id);
        renderConfirmations();
        try {
          setBusy(true, "Running confirmed action...");
          const result = await adapter.executeAction(confirmation.name, confirmation.args);
          appendMessage("action", result.message ?? "Confirmed action completed.");
        } catch (error) {
          appendMessage("action", error.message ?? "Confirmed action failed.");
        } finally {
          setBusy(false);
        }
      });
      cancel.addEventListener("click", () => {
        state.confirmations = state.confirmations.filter((item) => item.id !== confirmation.id);
        renderConfirmations();
        appendMessage("action", `Canceled: ${confirmation.label}`);
      });
      actions.append(confirm, cancel);
      card.append(body, actions);
      confirmationsEl.append(card);
    }
  }

  collapseButton.addEventListener("click", () => {
    const collapsed = root.classList.toggle("is-collapsed");
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
  });

  modelSelect.addEventListener("change", () => {
    const model = getAssistantModel(modelSelect.value);
    const previousEffort = reasoningSelect.value;
    const nextEffort = model?.reasoningEfforts?.includes(previousEffort)
      ? previousEffort
      : defaultReasoningEffortForModel(modelSelect.value);
    reasoningSelect.innerHTML = reasoningOptionsHtml(modelSelect.value, nextEffort);
    reasoningSelect.value = nextEffort;
  });

  resetButton.addEventListener("click", resetConversation);
  saveButton.addEventListener("click", saveConversation);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || state.busy) return;
    input.value = "";
    appendMessage("user", message);
    setBusy(true, "Contacting assistant...");
    try {
      const result = await runAssistantTurn({
        adapter,
        model: modelSelect.value,
        reasoningEffort: reasoningSelect.value,
        previousResponseId: state.previousResponseId,
        message,
        onResponse: (response) => setLastMetrics(response),
        onAssistantText: (text) => appendMessage("assistant", text),
        onGuardedToolCall: ({ toolCall, definition, args }) => {
          const id = `${toolCall.callId}-${Date.now()}`;
          const label = definition.confirmation ?? summarizeAction(definition, args);
          state.confirmations.push({ id, name: toolCall.name, args, label });
          renderConfirmations();
          appendMessage("action", `Confirmation required: ${label}`);
          return {
            output: {
              ok: false,
              action: toolCall.name,
              status: "pending_confirmation",
              message: label
            }
          };
        },
        onToolResult: (resolved, toolCall) => {
          if (resolved.guarded) return;
          const output = resolved.output ?? {};
          appendMessage("action", output.message ?? output.error ?? `${toolCall.name} completed.`);
        }
      });
      state.previousResponseId = result.previousResponseId;
      const stopMessage = assistantStopMessage(result);
      if (stopMessage) appendMessage("assistant", stopMessage);
      setBusy(false);
    } catch (error) {
      appendMessage("assistant", error.message ?? "Assistant request failed.");
      setBusy(false);
    }
  });

  function viewportBox() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function cardBox() {
    const rect = root.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function applyPosition(position) {
    const next = clampAssistantPosition(position, viewportBox(), cardBox());
    state.position = next;
    root.style.left = `${next.x}px`;
    root.style.top = `${next.y}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
  }

  headerEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || isAssistantDragBlocked(event.target)) return;
    const rect = root.getBoundingClientRect();
    state.drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    root.classList.add("is-dragging");
    root.setPointerCapture?.(event.pointerId);
    applyPosition({ x: rect.left, y: rect.top });
  });

  window.addEventListener("pointermove", (event) => {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    applyPosition({
      x: event.clientX - state.drag.offsetX,
      y: event.clientY - state.drag.offsetY
    });
  });

  window.addEventListener("pointerup", (event) => {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    root.classList.remove("is-dragging");
    root.releasePointerCapture?.(event.pointerId);
    state.drag = null;
    if (state.position) applyPosition(state.position);
  });

  window.addEventListener("resize", () => {
    if (state.position) applyPosition(state.position);
  });

  document.body.append(root);
  appendMessage("assistant", "I can operate this page with safe automatic actions and will ask before guarded actions.");
  return { root, adapter };
}
