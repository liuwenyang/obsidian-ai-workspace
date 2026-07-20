const assert = require("assert");
const {
  DEFAULT_CONVERSATION_SYNC_FOLDER,
  normalizeConversationSyncFolder,
  conversationSyncPath,
  createConversationSyncDocument,
  serializeConversationSyncDocument,
  parseConversationSyncDocument,
  mergeConversationSnapshots,
  mergeConversationCollections,
} = require("../conversation-sync-utils");

function message(id, content, overrides = {}) {
  return {
    id,
    role: "user",
    content,
    providerId: "codex",
    providerTurnId: `turn-${id}`,
    providerItemId: `item-${id}`,
    kind: "message",
    status: "completed",
    meta: {},
    attachments: [],
    ...overrides,
  };
}

function conversation(id, messages, updatedAt, overrides = {}) {
  return {
    id,
    providerId: "codex",
    title: `Conversation ${id}`,
    sessionId: `session-${id}`,
    providerThreadId: `thread-${id}`,
    providerThreadModel: "device-local-model",
    forkedFromTurnId: `turn-parent-${id}`,
    createdAt: 100,
    updatedAt,
    messages,
    ...overrides,
  };
}

assert.strictEqual(normalizeConversationSyncFolder("../outside"), DEFAULT_CONVERSATION_SYNC_FOLDER);
assert.strictEqual(normalizeConversationSyncFolder("/AI Workspace//Chats/"), "AI Workspace/Chats");
assert.strictEqual(
  conversationSyncPath("AI Workspace/Chats", conversation("abc:unsafe", [], 1)),
  "AI Workspace/Chats/codex/abc-unsafe.md",
);

const original = conversation(
  "conversation-1",
  [
    message("message-1", "hello", {
      notePath: "Notes/hello.md",
      attachments: [
        {
          id: "attachment-1",
          name: "image.png",
          path: "_attachments/ai-chat/image.png",
          mime: "image/png",
          size: 12,
          createdAt: 200,
        },
      ],
    }),
  ],
  300,
);
const safeDocument = createConversationSyncDocument(original);
assert.strictEqual(safeDocument.conversation.sessionId, undefined);
assert.strictEqual(safeDocument.conversation.providerThreadId, undefined);
assert.strictEqual(safeDocument.conversation.providerThreadModel, undefined);
assert.strictEqual(safeDocument.conversation.forkedFromTurnId, undefined);
assert.strictEqual(safeDocument.conversation.messages[0].providerTurnId, undefined);
assert.strictEqual(safeDocument.conversation.messages[0].providerItemId, undefined);
assert.strictEqual(safeDocument.conversation.messages[0].attachments[0].path, "_attachments/ai-chat/image.png");
const unsafePaths = createConversationSyncDocument(
  conversation(
    "unsafe-paths",
    [
      message("unsafe-message", "paths", {
        notePath: "C:\\private\\note.md",
        attachments: [{ id: "unsafe-attachment", path: "../outside.png" }],
      }),
    ],
    301,
  ),
);
assert.strictEqual(unsafePaths.conversation.messages[0].notePath, "");
assert.deepStrictEqual(unsafePaths.conversation.messages[0].attachments, []);

const markdown = serializeConversationSyncDocument(original);
const roundTrip = parseConversationSyncDocument(markdown);
assert.deepStrictEqual(roundTrip, safeDocument);
assert(!markdown.includes("session-conversation-1"));
assert(!markdown.includes("thread-conversation-1"));
assert(markdown.includes("AI Workspace 对话存档"));

const shorter = conversation("prefix", [message("a", "old")], 200);
const longer = conversation("prefix", [message("a", "new"), message("b", "second")], 300);
const prefixMerge = mergeConversationSnapshots(shorter, longer);
assert.strictEqual(prefixMerge.conflict, null);
assert.deepStrictEqual(prefixMerge.primary.messages.map((item) => item.id), ["a", "b"]);
assert.strictEqual(prefixMerge.primary.messages[0].content, "new");

const localBranch = conversation("diverged", [message("a", "root"), message("local", "local")], 400);
const remoteBranch = conversation("diverged", [message("a", "root"), message("remote", "remote")], 500);
const divergentMerge = mergeConversationSnapshots(localBranch, remoteBranch);
assert.strictEqual(divergentMerge.primary.messages[1].id, "remote");
assert(divergentMerge.conflict);
assert.strictEqual(divergentMerge.conflict.messages[1].id, "local");
assert.strictEqual(divergentMerge.conflict.parentConversationId, "diverged");
assert.strictEqual(divergentMerge.conflict.forkedFromMessageId, "a");
assert(divergentMerge.conflict.id.startsWith("sync-conflict-diverged-"));
assert.strictEqual(
  mergeConversationSnapshots(localBranch, remoteBranch).conflict.id,
  divergentMerge.conflict.id,
  "conflict IDs must stay deterministic across devices",
);

const collectionMerge = mergeConversationCollections(
  [conversation("local-only", [message("l", "local")], 100), localBranch],
  [conversation("remote-only", [message("r", "remote")], 200), remoteBranch],
  "codex",
);
assert(collectionMerge.conversations.some((item) => item.id === "local-only"));
assert(collectionMerge.conversations.some((item) => item.id === "remote-only"));
assert(collectionMerge.conversations.some((item) => item.id === "diverged"));
assert(collectionMerge.conversations.some((item) => item.id.startsWith("sync-conflict-diverged-")));
assert.strictEqual(collectionMerge.conflicts.length, 1);

console.log("codex-chat conversation sync tests passed");
