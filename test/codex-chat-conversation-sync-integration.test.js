const assert = require("assert");
const Module = require("module");
const {
  serializeConversationSyncDocument,
  parseConversationSyncDocument,
} = require("../conversation-sync-utils");

class FakePlugin {
  async saveData(value) {
    this.savedData = value;
  }
}

const fakeObsidian = {
  ItemView: class {},
  MarkdownRenderer: { render: async () => {} },
  MarkdownView: class {},
  Modal: class {},
  Notice: class {},
  Plugin: FakePlugin,
  PluginSettingTab: class {},
  Setting: class {},
  setIcon: () => {},
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") return fakeObsidian;
  if (request === "./conversation-sync-utils") {
    throw new Error("Published main.js must keep conversation sync logic self-contained");
  }
  return originalLoad.call(this, request, parent, isMain);
};

let AgentWorkspacePlugin;
try {
  AgentWorkspacePlugin = require("../main");
} finally {
  Module._load = originalLoad;
}

function message(id, role, content) {
  return {
    id,
    providerTurnId: `turn-${id}`,
    providerItemId: `item-${id}`,
    revisionOf: null,
    kind: "message",
    title: "",
    role,
    content,
    notePath: "",
    providerId: "codex",
    model: "",
    status: "completed",
    meta: {},
    attachments: [],
  };
}

function createSettings(conversation) {
  return {
    activeProvider: "codex",
    codexBackend: "app-server",
    codexPath: "C:\\local\\codex.cmd",
    reclaudePath: "",
    claudePath: "",
    models: { codex: "", reclaude: "sonnet", claude: "sonnet" },
    maxContextChars: 60000,
    includeCurrentNote: true,
    allowEdits: false,
    sessions: { codex: conversation.providerThreadId, reclaude: null, claude: null },
    histories: { codex: conversation.messages, reclaude: [], claude: [] },
    conversations: { codex: [conversation], reclaude: [], claude: [] },
    activeConversationIds: { codex: conversation.id, reclaude: null, claude: null },
    syncConversations: true,
    conversationSyncFolder: "AI Workspace/Conversations",
  };
}

const localConversation = {
  id: "sync-integration",
  providerId: "codex",
  title: "跨设备测试",
  sessionId: "local-thread",
  providerThreadId: "local-thread",
  parentConversationId: null,
  rootConversationId: null,
  forkedFromMessageId: null,
  forkedFromTurnId: null,
  forkMode: "before",
  branchKind: "native",
  branchDepth: 0,
  model: "",
  createdAt: 100,
  updatedAt: 200,
  messages: [message("message-1", "user", "第一问")],
};

const files = new Map();
let writes = 0;
const plugin = new AgentWorkspacePlugin();
plugin.settings = createSettings(localConversation);
plugin.persistQueue = Promise.resolve();
plugin.syncFileCache = new Map();
plugin.isLoadingConversationSync = false;
plugin.lastConversationSyncError = "";
plugin.lastConversationSyncWriteCount = 0;
plugin.app = {
  vault: {
    getFiles: () => [...files.values()].filter((file) => typeof file.extension === "string"),
    getAbstractFileByPath: (filePath) => files.get(filePath) || null,
    createFolder: async (folderPath) => {
      files.set(folderPath, { path: folderPath });
    },
    create: async (filePath, content) => {
      const file = { path: filePath, extension: "md", content };
      files.set(filePath, file);
      writes += 1;
      return file;
    },
    read: async (file) => file.content,
    modify: async (file, content) => {
      file.content = content;
      writes += 1;
    },
  },
  workspace: {
    getLeavesOfType: () => [],
  },
};

(async () => {
  await plugin.persist();
  const syncPath = "AI Workspace/Conversations/codex/sync-integration.md";
  const synchronizedFile = files.get(syncPath);
  assert(synchronizedFile, "existing data.json conversation should be exported on first persist");
  assert.strictEqual(writes, 1);
  assert(!synchronizedFile.content.includes("C:\\local\\codex.cmd"));
  assert(!synchronizedFile.content.includes("local-thread"));
  const exported = parseConversationSyncDocument(synchronizedFile.content).conversation;
  assert.strictEqual(exported.messages.length, 1);
  assert.strictEqual(exported.messages[0].providerTurnId, undefined);

  await plugin.persist();
  assert.strictEqual(writes, 1, "unchanged sync content must not be rewritten");

  const remoteConversation = {
    ...exported,
    updatedAt: 300,
    messages: [
      exported.messages[0],
      {
        ...message("message-2", "assistant", "远端回答"),
        providerTurnId: null,
        providerItemId: null,
      },
    ],
  };
  synchronizedFile.content = serializeConversationSyncDocument(remoteConversation);
  plugin.syncFileCache.set(syncPath, synchronizedFile.content);
  await plugin.syncConversationsNow();

  const merged = plugin.getActiveConversation("codex");
  assert.deepStrictEqual(merged.messages.map((item) => item.id), ["message-1", "message-2"]);
  assert.strictEqual(merged.providerThreadId, null, "a remote transcript extension must not reuse a stale local thread");
  assert.strictEqual(merged.sessionId, null);
  assert.strictEqual(merged.branchKind, "compatible");

  const currentMessage = message("message-3", "user", "当前问题");
  merged.messages.push(currentMessage);
  const requests = [];
  plugin.ensureCodexAppServer = async () => ({
    request: async (method, params) => {
      requests.push({ method, params });
      return {};
    },
  });
  plugin.startCodexThread = async () => ({ id: "new-local-thread" });
  plugin.updateConversationFromCodexThread = async (_conversationId, thread, branchKind) => {
    merged.providerThreadId = thread.id;
    merged.sessionId = thread.id;
    merged.branchKind = branchKind;
    return merged;
  };
  const threadId = await plugin.ensureCodexConversationThread(merged, currentMessage.id);
  assert.strictEqual(threadId, "new-local-thread");
  const injection = requests.find((request) => request.method === "thread/inject_items");
  assert(injection, "synced history should be injected into a new local Codex thread");
  assert.deepStrictEqual(
    injection.params.items.map((item) => item.content[0].text),
    ["第一问", "远端回答"],
    "the current user message must not be injected twice",
  );

  console.log("codex-chat conversation sync integration tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
