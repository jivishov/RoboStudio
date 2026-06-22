import { randomUUID } from "node:crypto";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_ASSISTANT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ASSISTANT_UPLOAD_BODY_BYTES = 40 * 1024 * 1024;

const DEFAULT_ATTACHMENT_TYPE = "application/octet-stream";
const MAX_ATTACHMENT_NAME_LENGTH = 180;
const VISION_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const VISION_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function sanitizeAttachmentName(value) {
  const cleaned = String(value || "attachment")
    .replace(/\0/g, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop();
  return (cleaned || "attachment").trim().slice(0, MAX_ATTACHMENT_NAME_LENGTH) || "attachment";
}

function sanitizeAttachmentType(value) {
  const type = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(type) ? type : DEFAULT_ATTACHMENT_TYPE;
}

function attachmentExtension(name) {
  const index = String(name).lastIndexOf(".");
  return index >= 0 ? String(name).slice(index).toLowerCase() : "";
}

function attachmentInputKind(name, type) {
  if (VISION_IMAGE_TYPES.has(type)) return "image";
  if (VISION_IMAGE_EXTENSIONS.has(attachmentExtension(name))) return "image";
  return "file";
}

function openAiPurposeForInputKind(inputKind) {
  return inputKind === "image" ? "vision" : "user_data";
}

function jsonErrorMessage(parsed, fallback) {
  return parsed?.error?.message ?? parsed?.message ?? fallback;
}

function publicAttachmentMetadata(record) {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    size: record.size
  };
}

function decodeUploadFile(file) {
  const name = sanitizeAttachmentName(file?.name);
  if (typeof file?.dataBase64 !== "string" || !file.dataBase64) {
    throw new Error(`${name} has no file data.`);
  }
  const data = Buffer.from(file.dataBase64, "base64");
  if (!data.byteLength) throw new Error(`${name} is empty.`);
  if (data.byteLength > MAX_ASSISTANT_ATTACHMENT_BYTES) {
    throw new Error(`${name} is larger than ${Math.floor(MAX_ASSISTANT_ATTACHMENT_BYTES / 1024 / 1024)} MB.`);
  }
  return {
    name,
    type: sanitizeAttachmentType(file?.type),
    data
  };
}

export function decodeUploadFiles(payload) {
  const files = Array.isArray(payload?.files) ? payload.files : [];
  if (!files.length) throw new Error("No assistant files were provided.");
  return files.map(decodeUploadFile);
}

async function parseJsonResponse(response, fallbackMessage) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: { message: text || fallbackMessage } };
  }
}

async function uploadOpenAiFile({ apiKey, record, fetchImpl }) {
  const bytes = await readFile(record.localPath);
  const form = new FormData();
  form.append("purpose", record.openAiPurpose);
  form.append("file", new Blob([bytes], { type: record.type }), record.name);

  const response = await fetchImpl("https://api.openai.com/v1/files", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`
    },
    body: form
  });
  const parsed = await parseJsonResponse(response, "OpenAI file upload failed.");
  if (!response.ok) {
    throw new Error(jsonErrorMessage(parsed, `OpenAI file upload failed with ${response.status}.`));
  }
  if (!parsed?.id) throw new Error("OpenAI file upload did not return a file id.");
  return parsed.id;
}

async function deleteOpenAiFile({ apiKey, fileId, fetchImpl }) {
  const response = await fetchImpl(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${apiKey}`
    }
  });
  if (response.ok || response.status === 404) return;
  const parsed = await parseJsonResponse(response, "OpenAI file cleanup failed.");
  throw new Error(jsonErrorMessage(parsed, `OpenAI file cleanup failed with ${response.status}.`));
}

export function createAssistantAttachmentStore(options = {}) {
  const records = new Map();
  const tempRoot = options.tempRoot ?? join(tmpdir(), `robostudio-assistant-${process.pid}`);
  let ready = null;

  async function ensureReady() {
    ready ??= mkdir(tempRoot, { recursive: true });
    await ready;
  }

  function recordsForIds(attachmentIds = []) {
    const ids = [...new Set(attachmentIds.filter((id) => typeof id === "string" && id))];
    return ids.map((id) => {
      const record = records.get(id);
      if (!record) throw new Error("One or more assistant attachments are no longer available.");
      return record;
    });
  }

  async function stageFile(file) {
    const id = randomUUID();
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data ?? []);
    const name = sanitizeAttachmentName(file.name);
    if (!data.byteLength) throw new Error(`${name} is empty.`);
    if (data.byteLength > MAX_ASSISTANT_ATTACHMENT_BYTES) {
      throw new Error(`${name} is larger than ${Math.floor(MAX_ASSISTANT_ATTACHMENT_BYTES / 1024 / 1024)} MB.`);
    }
    await ensureReady();
    const localPath = join(tempRoot, id);
    const type = sanitizeAttachmentType(file.type);
    const inputKind = attachmentInputKind(name, type);
    const record = {
      id,
      name,
      type,
      size: data.byteLength,
      localPath,
      inputKind,
      openAiPurpose: openAiPurposeForInputKind(inputKind),
      openAiFileId: null
    };
    await writeFile(localPath, data);
    records.set(id, record);
    return publicAttachmentMetadata(record);
  }

  async function openAiFileInputsForIds(attachmentIds = [], { apiKey, fetchImpl = fetch } = {}) {
    const selected = recordsForIds(attachmentIds);
    if (!selected.length) return [];
    if (!apiKey) throw new Error("OPENAI_API_KEY is required to upload assistant attachments.");

    const fileInputs = [];
    for (const record of selected) {
      if (!record.openAiFileId) {
        record.openAiFileId = await uploadOpenAiFile({ apiKey, record, fetchImpl });
      }
      fileInputs.push({
        fileId: record.openAiFileId,
        name: record.name,
        type: record.type,
        size: record.size,
        inputKind: record.inputKind
      });
    }
    return fileInputs;
  }

  async function cleanupAttachmentIds(attachmentIds = [], { apiKey, fetchImpl = fetch } = {}) {
    const ids = [...new Set(attachmentIds.filter((id) => typeof id === "string" && id))];
    let removed = 0;
    for (const id of ids) {
      const record = records.get(id);
      if (!record) continue;
      if (record.openAiFileId) {
        if (!apiKey) throw new Error("OPENAI_API_KEY is required to delete uploaded assistant files.");
        await deleteOpenAiFile({ apiKey, fileId: record.openAiFileId, fetchImpl });
      }
      await rm(record.localPath, { force: true });
      records.delete(id);
      removed += 1;
    }
    return { removed };
  }

  return {
    stageFile,
    openAiFileInputsForIds,
    cleanupAttachmentIds,
    publicMetadataForIds: (attachmentIds = []) => recordsForIds(attachmentIds).map(publicAttachmentMetadata)
  };
}
