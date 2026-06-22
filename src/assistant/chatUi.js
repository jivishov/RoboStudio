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
import { addUsageTotals, runAssistantTurn } from "./turnRunner.js";
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

const MAX_CLIENT_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks = [];
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return btoa(chunks.join(""));
}

async function postJson(url, payload, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(parsed.error ?? `Request failed with ${response.status}`);
  return parsed;
}

async function stageAssistantAttachments(files) {
  const selected = Array.from(files ?? []);
  if (!selected.length) return [];
  const tooLarge = selected.find((file) => file.size > MAX_CLIENT_ATTACHMENT_BYTES);
  if (tooLarge) throw new Error(`${tooLarge.name} is larger than ${formatFileSize(MAX_CLIENT_ATTACHMENT_BYTES)}.`);
  const encodedFiles = [];
  for (const file of selected) {
    encodedFiles.push({
      name: file.name,
      type: file.type,
      dataBase64: await fileToBase64(file)
    });
  }
  const response = await postJson("/api/assistant/attachments", { files: encodedFiles });
  return Array.isArray(response.attachments) ? response.attachments : [];
}

async function cleanupAssistantAttachments(attachmentIds) {
  const ids = [...new Set((attachmentIds ?? []).filter(Boolean))];
  if (!ids.length) return;
  await postJson("/api/assistant/attachments", { attachmentIds: ids }, { method: "DELETE" });
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
        <div class="assistant-card__form-actions">
          <input type="file" multiple data-assistant-file-input hidden>
          <button class="assistant-card__attach" type="button" title="Attach files" aria-label="Attach files" data-assistant-attach>
            ${materialIcon("upload_file")}
          </button>
          <button type="submit">Send</button>
        </div>
        <div class="assistant-card__attachments" aria-live="polite"></div>
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
  const attachButton = root.querySelector("[data-assistant-attach]");
  const fileInput = root.querySelector("[data-assistant-file-input]");
  const attachmentsEl = root.querySelector(".assistant-card__attachments");
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
    nextMessageId: 1,
    attachments: [],
    uploadingAttachments: false
  };

  function hasPendingConfirmation() {
    return state.confirmations.length > 0;
  }

  function pendingConfirmationStatus() {
    return "Confirm or cancel the pending action before sending another message.";
  }

  function idleStatusText() {
    return hasPendingConfirmation() ? pendingConfirmationStatus() : state.lastMetrics;
  }

  function updateInteractiveState() {
    const locked = state.busy || state.uploadingAttachments;
    const pendingConfirmation = hasPendingConfirmation();
    sendButton.disabled = locked || pendingConfirmation;
    attachButton.disabled = locked || pendingConfirmation;
    resetButton.disabled = locked;
    modelSelect.disabled = locked || pendingConfirmation;
    reasoningSelect.disabled = locked || pendingConfirmation;
    for (const button of attachmentsEl.querySelectorAll("button")) button.disabled = locked || pendingConfirmation;
    for (const button of confirmationsEl.querySelectorAll("button")) button.disabled = locked;
  }

  function setBusy(busy, message = "") {
    state.busy = busy;
    updateInteractiveState();
    statusEl.textContent = message || (!busy ? idleStatusText() : "");
    root.classList.toggle("is-busy", busy);
  }

  function setUploadingAttachments(uploading, message = "") {
    state.uploadingAttachments = uploading;
    updateInteractiveState();
    statusEl.textContent = message || (!uploading ? idleStatusText() : "");
    root.classList.toggle("is-uploading-attachments", uploading);
  }

  function setLastMetrics(response) {
    state.conversationUsage = addUsageTotals(state.conversationUsage, response?.usage);
    state.lastMetrics = formatResponseMetrics(response, state.conversationUsage);
    if (!state.busy && !hasPendingConfirmation() && state.lastMetrics) statusEl.textContent = state.lastMetrics;
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

  function attachmentIds() {
    return state.attachments.map((attachment) => attachment.id).filter(Boolean);
  }

  function userMessageText(message, attachments = []) {
    if (!attachments.length) return message;
    const names = attachments.map((attachment) => `${attachment.name} (${formatFileSize(attachment.size)})`).join(", ");
    return `${message}\n\nAttached: ${names}`;
  }

  function renderAttachments() {
    attachmentsEl.replaceChildren();
    attachmentsEl.hidden = !state.attachments.length;
    if (!state.attachments.length) {
      updateInteractiveState();
      return;
    }
    for (const attachment of state.attachments) {
      const chip = createElement("span", "assistant-attachment");
      const label = createElement(
        "span",
        "assistant-attachment__label",
        `${attachment.name} (${formatFileSize(attachment.size)})`
      );
      const remove = createIconButton("assistant-attachment__remove", `Remove ${attachment.name}`, "delete");
      remove.addEventListener("click", async () => {
        if (state.busy || state.uploadingAttachments || hasPendingConfirmation()) return;
        const previous = state.attachments;
        state.attachments = state.attachments.filter((item) => item.id !== attachment.id);
        renderAttachments();
        try {
          await cleanupAssistantAttachments([attachment.id]);
          statusEl.textContent = `Removed ${attachment.name}.`;
        } catch (error) {
          state.attachments = previous;
          renderAttachments();
          statusEl.textContent = error.message ?? `Could not remove ${attachment.name}.`;
        }
      });
      chip.append(label, remove);
      attachmentsEl.append(chip);
    }
    updateInteractiveState();
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

  async function resetConversation() {
    if (state.busy || state.uploadingAttachments) return;
    const cleanupIds = attachmentIds();
    state.attachments = [];
    state.previousResponseId = null;
    state.confirmations = [];
    state.lastMetrics = "";
    state.conversationUsage = null;
    state.messages = [];
    state.nextMessageId = 1;
    input.value = "";
    messagesEl.replaceChildren();
    renderConfirmations();
    renderAttachments();
    try {
      await cleanupAssistantAttachments(cleanupIds);
      statusEl.textContent = "Conversation reset. Start a new request when ready.";
    } catch (error) {
      statusEl.textContent = error.message ?? "Conversation reset, but attachment cleanup failed.";
    }
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

  function addPendingGuardedCall(pendingGuardedCall) {
    if (!pendingGuardedCall?.responseId || !pendingGuardedCall?.callId || !pendingGuardedCall?.name) return;
    const confirmation = {
      id: `${pendingGuardedCall.callId}-${Date.now()}`,
      responseId: pendingGuardedCall.responseId,
      callId: pendingGuardedCall.callId,
      name: pendingGuardedCall.name,
      args: pendingGuardedCall.args ?? {},
      label: pendingGuardedCall.label ?? pendingGuardedCall.name
    };
    state.confirmations = state.confirmations.filter((item) => item.callId !== confirmation.callId);
    state.confirmations.push(confirmation);
    renderConfirmations();
    appendMessage("action", `Confirmation required: ${confirmation.label}`);
  }

  function turnCallbacks() {
    return {
      onResponse: (response) => setLastMetrics(response),
      onAssistantText: (text) => appendMessage("assistant", text),
      onGuardedToolCall: () => ({ defer: true }),
      onToolResult: (resolved, toolCall) => {
        if (resolved.guarded) return;
        const output = resolved.output ?? {};
        appendMessage("action", output.message ?? output.error ?? `${toolCall.name} completed.`);
      }
    };
  }

  function handleTurnResult(result) {
    state.previousResponseId = result.previousResponseId;
    if (result.pendingGuardedCall) addPendingGuardedCall(result.pendingGuardedCall);
    const stopMessage = assistantStopMessage(result);
    if (stopMessage) appendMessage("assistant", stopMessage);
    updateInteractiveState();
    if (!state.busy) statusEl.textContent = idleStatusText();
  }

  function removeConfirmation(confirmationId) {
    state.confirmations = state.confirmations.filter((item) => item.id !== confirmationId);
    renderConfirmations();
  }

  async function continueAssistantWithGuardedOutput(confirmation, output) {
    setBusy(true, "Continuing assistant...");
    const result = await runAssistantTurn({
      adapter,
      model: modelSelect.value,
      reasoningEffort: reasoningSelect.value,
      previousResponseId: confirmation.responseId,
      toolOutputs: [{ callId: confirmation.callId, output }],
      ...turnCallbacks()
    });
    handleTurnResult(result);
  }

  async function confirmGuardedAction(confirmation) {
    removeConfirmation(confirmation.id);
    let output;
    try {
      setBusy(true, "Running confirmed action...");
      output = await adapter.executeAction(confirmation.name, confirmation.args);
      appendMessage("action", output.message ?? "Confirmed action completed.");
    } catch (error) {
      const message = error.message ?? "Confirmed action failed.";
      output = { ok: false, action: confirmation.name, error: message };
      appendMessage("action", message);
    }

    try {
      await continueAssistantWithGuardedOutput(confirmation, output);
    } catch (error) {
      appendMessage("assistant", error.message ?? "Assistant continuation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelGuardedAction(confirmation) {
    removeConfirmation(confirmation.id);
    const output = {
      ok: false,
      action: confirmation.name,
      status: "canceled",
      message: `Canceled: ${confirmation.label}`
    };
    appendMessage("action", output.message);

    try {
      await continueAssistantWithGuardedOutput(confirmation, output);
    } catch (error) {
      appendMessage("assistant", error.message ?? "Assistant continuation failed.");
    } finally {
      setBusy(false);
    }
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
      confirm.disabled = state.busy || state.uploadingAttachments;
      cancel.disabled = state.busy || state.uploadingAttachments;
      confirm.addEventListener("click", () => confirmGuardedAction(confirmation));
      cancel.addEventListener("click", () => cancelGuardedAction(confirmation));
      actions.append(confirm, cancel);
      card.append(body, actions);
      confirmationsEl.append(card);
    }
    updateInteractiveState();
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
  attachButton.addEventListener("click", () => {
    if (state.busy || state.uploadingAttachments) return;
    if (hasPendingConfirmation()) {
      statusEl.textContent = pendingConfirmationStatus();
      return;
    }
    fileInput.click();
  });
  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = "";
    if (!files.length) return;
    if (hasPendingConfirmation()) {
      statusEl.textContent = pendingConfirmationStatus();
      return;
    }
    try {
      setUploadingAttachments(true, "Uploading attachments...");
      const attachments = await stageAssistantAttachments(files);
      state.attachments.push(...attachments);
      renderAttachments();
      statusEl.textContent =
        attachments.length === 1 ? `Attached ${attachments[0].name}.` : `Attached ${attachments.length} files.`;
    } catch (error) {
      statusEl.textContent = error.message ?? "Attachment upload failed.";
    } finally {
      setUploadingAttachments(false, statusEl.textContent);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || state.busy || state.uploadingAttachments) return;
    if (hasPendingConfirmation()) {
      statusEl.textContent = pendingConfirmationStatus();
      return;
    }
    const attachmentsForTurn = [...state.attachments];
    input.value = "";
    appendMessage("user", userMessageText(message, attachmentsForTurn));
    setBusy(true, "Contacting assistant...");
    try {
      const result = await runAssistantTurn({
        adapter,
        model: modelSelect.value,
        reasoningEffort: reasoningSelect.value,
        previousResponseId: state.previousResponseId,
        message,
        attachmentIds: attachmentsForTurn.map((attachment) => attachment.id),
        ...turnCallbacks()
      });
      handleTurnResult(result);
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
