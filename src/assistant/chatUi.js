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

export function mountPageAssistant(config) {
  const adapter = createPageAssistantAdapter(config);
  const root = createElement("section", "assistant-card");
  root.setAttribute("aria-label", `${adapter.title ?? "Page"} assistant`);
  const initialModelId = defaultAssistantModelId();
  root.innerHTML = `
    <div class="assistant-card__header">
      <button class="assistant-card__collapse" type="button" aria-expanded="true" aria-controls="assistant-card-body">
        <span class="assistant-card__title">Assistant</span>
        <span class="assistant-card__chevron" aria-hidden="true"></span>
      </button>
      <div class="assistant-card__controls" data-assistant-no-drag>
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
    conversationUsage: null
  };

  function setBusy(busy, message = "") {
    state.busy = busy;
    sendButton.disabled = busy;
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
    const item = createElement("article", `assistant-message assistant-message--${role}`);
    const label = createElement("span", "assistant-message__role", role === "user" ? "You" : role === "action" ? "Action" : "Assistant");
    const body = createElement("p", "assistant-message__text", text);
    item.append(label, body);
    messagesEl.append(item);
    messagesEl.scrollTop = messagesEl.scrollHeight;
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
      if (result.stoppedForMaxRounds) {
        appendMessage("assistant", "The assistant stopped after several action rounds. Send another message to continue.");
      }
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
