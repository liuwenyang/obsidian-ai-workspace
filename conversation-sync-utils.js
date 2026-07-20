const path = require("path");

const CONVERSATION_SYNC_SCHEMA_VERSION = 1;
const DEFAULT_CONVERSATION_SYNC_FOLDER = "AI Workspace/Conversations";
const SYNC_DATA_START = "<!-- AI_WORKSPACE_DATA_START -->";
const SYNC_DATA_END = "<!-- AI_WORKSPACE_DATA_END -->";
const SYNC_PROVIDER_IDS = new Set(["codex", "reclaude", "claude"]);

function cleanSyncId(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}

function normalizeConversationSyncFolder(value) {
  const normalized = String(value || DEFAULT_CONVERSATION_SYNC_FOLDER)
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim();
  if (!normalized || normalized.includes(":") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    return DEFAULT_CONVERSATION_SYNC_FOLDER;
  }
  return normalized;
}

function safeSyncFilePart(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
  return cleaned || fallback;
}

function conversationSyncPath(folder, conversation) {
  const providerId = SYNC_PROVIDER_IDS.has(conversation && conversation.providerId)
    ? conversation.providerId
    : "codex";
  const conversationId = safeSyncFilePart(conversation && conversation.id, "conversation");
  return path.posix.join(normalizeConversationSyncFolder(folder), providerId, `${conversationId}.md`);
}

function syncSafeVaultPath(value) {
  const normalized = typeof value === "string" ? value.replace(/\\/g, "/").replace(/^\/+/, "") : "";
  if (!normalized || normalized.includes(":") || normalized.split("/").some((part) => part === "..")) return "";
  return normalized;
}

function syncSafeAttachment(value) {
  if (!value || typeof value !== "object") return null;
  const id = cleanSyncId(value.id);
  const attachmentPath = syncSafeVaultPath(value.path);
  if (!id || !attachmentPath) return null;
  return {
    id,
    name: typeof value.name === "string" ? value.name.slice(0, 300) : "image",
    path: attachmentPath,
    mime: typeof value.mime === "string" ? value.mime.slice(0, 100) : "",
    size: Number.isFinite(Number(value.size)) ? Math.max(0, Number(value.size)) : 0,
    createdAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : 0,
  };
}

function syncSafeMessage(value, providerId) {
  if (!value || !["user", "assistant", "system"].includes(value.role) || typeof value.content !== "string") {
    return null;
  }
  const id = cleanSyncId(value.id);
  if (!id) return null;
  return {
    id,
    revisionOf: cleanSyncId(value.revisionOf),
    kind: typeof value.kind === "string" ? value.kind.slice(0, 40) : "message",
    title: typeof value.title === "string" ? value.title.slice(0, 300) : "",
    role: value.role,
    content: value.content,
    notePath: syncSafeVaultPath(value.notePath),
    providerId,
    model: typeof value.model === "string" ? value.model.slice(0, 200) : "",
    status: typeof value.status === "string" ? value.status.slice(0, 40) : "completed",
    meta: value.meta && typeof value.meta === "object" ? { ...value.meta } : {},
    attachments: Array.isArray(value.attachments) ? value.attachments.map(syncSafeAttachment).filter(Boolean) : [],
  };
}

function createConversationSyncDocument(conversationValue) {
  const value = conversationValue && typeof conversationValue === "object" ? conversationValue : {};
  const providerId = SYNC_PROVIDER_IDS.has(value.providerId) ? value.providerId : "codex";
  const id = cleanSyncId(value.id);
  if (!id) throw new Error("同步会话缺少稳定 ID");
  const createdAt = Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : Date.now();
  const updatedAt = Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : createdAt;
  const messages = Array.isArray(value.messages)
    ? value.messages.map((message) => syncSafeMessage(message, providerId)).filter(Boolean)
    : [];
  return {
    kind: "ai-workspace-conversation",
    schemaVersion: CONVERSATION_SYNC_SCHEMA_VERSION,
    conversation: {
      id,
      providerId,
      title: typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 80) : "新对话",
      parentConversationId: cleanSyncId(value.parentConversationId),
      rootConversationId: cleanSyncId(value.rootConversationId),
      forkedFromMessageId: cleanSyncId(value.forkedFromMessageId),
      forkMode: value.forkMode === "through" ? "through" : "before",
      branchDepth: Number.isInteger(Number(value.branchDepth)) && Number(value.branchDepth) >= 0
        ? Number(value.branchDepth)
        : 0,
      model: typeof value.model === "string" ? value.model.slice(0, 200) : "",
      createdAt,
      updatedAt,
      messages,
    },
  };
}

function yamlString(value) {
  return JSON.stringify(String(value || ""));
}

function serializeConversationSyncDocument(conversation) {
  const document = createConversationSyncDocument(conversation);
  const value = document.conversation;
  const title = value.title.replace(/[\r\n]+/g, " ").trim() || "新对话";
  return [
    "---",
    `ai_workspace_sync: ${CONVERSATION_SYNC_SCHEMA_VERSION}`,
    `provider: ${yamlString(value.providerId)}`,
    `conversation_id: ${yamlString(value.id)}`,
    `updated_at: ${value.updatedAt}`,
    "---",
    "",
    `# AI Workspace 对话存档：${title}`,
    "",
    "> 此文件由 AI Workspace 自动维护，用于跨设备同步。请不要手工修改机器数据。",
    "",
    "<details>",
    "<summary>同步数据（请勿编辑）</summary>",
    "",
    SYNC_DATA_START,
    "```json",
    JSON.stringify(document, null, 2),
    "```",
    SYNC_DATA_END,
    "",
    "</details>",
    "",
  ].join("\n");
}

function parseConversationSyncDocument(textValue) {
  const text = String(textValue || "");
  const start = text.indexOf(SYNC_DATA_START);
  const end = text.lastIndexOf(SYNC_DATA_END);
  if (start < 0 || end <= start) throw new Error("不是有效的 AI Workspace 会话同步文件");
  let payload = text.slice(start + SYNC_DATA_START.length, end).trim();
  payload = payload.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(payload);
  if (
    !parsed ||
    parsed.kind !== "ai-workspace-conversation" ||
    parsed.schemaVersion !== CONVERSATION_SYNC_SCHEMA_VERSION ||
    !parsed.conversation
  ) {
    throw new Error("不支持的 AI Workspace 会话同步版本");
  }
  return createConversationSyncDocument(parsed.conversation);
}

function isMessagePrefix(left, right) {
  if (left.length > right.length) return false;
  return left.every((message, index) => message.id === right[index].id);
}

function commonMessagePrefixLength(left, right) {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (index < length && left[index].id === right[index].id) index += 1;
  return index;
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function compareConversationSnapshots(left, right) {
  const updated = Number(left.updatedAt || 0) - Number(right.updatedAt || 0);
  if (updated) return updated;
  const leftKey = JSON.stringify(left);
  const rightKey = JSON.stringify(right);
  return leftKey === rightKey ? 0 : leftKey > rightKey ? 1 : -1;
}

function mergePrefixSnapshots(left, right) {
  const newer = compareConversationSnapshots(left, right) >= 0 ? left : right;
  const longer = left.messages.length >= right.messages.length ? left : right;
  const newerById = new Map(newer.messages.map((message) => [message.id, message]));
  return {
    ...newer,
    createdAt: Math.min(Number(left.createdAt || 0), Number(right.createdAt || 0)) || Number(newer.createdAt || 0),
    updatedAt: Math.max(Number(left.updatedAt || 0), Number(right.updatedAt || 0)),
    messages: longer.messages.map((message) => newerById.get(message.id) || message),
  };
}

function createSyncConflictConversation(source, primary, commonLength) {
  const signature = JSON.stringify({
    id: source.id,
    updatedAt: source.updatedAt,
    messages: source.messages.map((message) => message.id),
  });
  const id = `sync-conflict-${safeSyncFilePart(source.id, "conversation").slice(0, 120)}-${stableHash(signature)}`;
  const boundary = commonLength > 0 ? source.messages[commonLength - 1] : null;
  return {
    ...source,
    id,
    title: `${source.title || "新对话"} · 同步分支`.slice(0, 80),
    parentConversationId: primary.id,
    rootConversationId: primary.rootConversationId || primary.id,
    forkedFromMessageId: boundary ? boundary.id : null,
    forkMode: "through",
    branchDepth: Math.max(Number(primary.branchDepth || 0), Number(source.branchDepth || 0)) + 1,
  };
}

function mergeConversationSnapshots(leftValue, rightValue) {
  const left = createConversationSyncDocument(leftValue).conversation;
  const right = createConversationSyncDocument(rightValue).conversation;
  if (left.id !== right.id || left.providerId !== right.providerId) {
    throw new Error("只能合并同一 Provider 的同一会话");
  }
  if (isMessagePrefix(left.messages, right.messages) || isMessagePrefix(right.messages, left.messages)) {
    return { primary: mergePrefixSnapshots(left, right), conflict: null };
  }
  const leftWins = compareConversationSnapshots(left, right) >= 0;
  const primary = leftWins ? left : right;
  const alternate = leftWins ? right : left;
  return {
    primary,
    conflict: createSyncConflictConversation(alternate, primary, commonMessagePrefixLength(left.messages, right.messages)),
  };
}

function mergeConversationCollections(localValue, incomingValue, providerId) {
  const provider = SYNC_PROVIDER_IDS.has(providerId) ? providerId : "codex";
  const merged = new Map();
  for (const conversation of Array.isArray(localValue) ? localValue : []) {
    const cleaned = createConversationSyncDocument({ ...conversation, providerId: provider }).conversation;
    merged.set(cleaned.id, cleaned);
  }
  const conflicts = [];
  for (const conversation of Array.isArray(incomingValue) ? incomingValue : []) {
    const cleaned = createConversationSyncDocument({ ...conversation, providerId: provider }).conversation;
    const existing = merged.get(cleaned.id);
    if (!existing) {
      merged.set(cleaned.id, cleaned);
      continue;
    }
    const result = mergeConversationSnapshots(existing, cleaned);
    merged.set(result.primary.id, result.primary);
    if (result.conflict && !merged.has(result.conflict.id)) {
      merged.set(result.conflict.id, result.conflict);
      conflicts.push(result.conflict);
    }
  }
  return {
    conversations: [...merged.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
    conflicts,
  };
}

module.exports = {
  CONVERSATION_SYNC_SCHEMA_VERSION,
  DEFAULT_CONVERSATION_SYNC_FOLDER,
  SYNC_DATA_START,
  SYNC_DATA_END,
  normalizeConversationSyncFolder,
  conversationSyncPath,
  createConversationSyncDocument,
  serializeConversationSyncDocument,
  parseConversationSyncDocument,
  mergeConversationSnapshots,
  mergeConversationCollections,
};
