const assert = require("assert");
const Module = require("module");
const path = require("path");

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
  if (request === "./attachment-utils") {
    throw new Error("Published main.js must not load attachment-utils through a relative CommonJS import");
  }
  return originalLoad.call(this, request, parent, isMain);
};

let AgentWorkspacePlugin;
try {
  AgentWorkspacePlugin = require("../main");
} finally {
  Module._load = originalLoad;
}

const files = new Map();
const createdFolders = [];
let writtenBinary = null;
const vaultRoot = process.cwd();
const plugin = new AgentWorkspacePlugin();
plugin.vaultPath = vaultRoot;
plugin.settings = {
  codexPath: "",
  reclaudePath: "",
  claudePath: "",
  allowEdits: false,
  maxContextChars: 60000,
  models: { codex: "", reclaude: "sonnet", claude: "sonnet" },
  sessions: { codex: null, reclaude: null, claude: null },
  histories: { codex: [], reclaude: [], claude: [] },
  conversations: { codex: [], reclaude: [], claude: [] },
  activeConversationIds: { codex: null, reclaude: null, claude: null },
};
plugin.app = {
  fileManager: {
    getAvailablePathForAttachment: async (name) => `_attachments/AI Workspace/${name}`,
  },
  vault: {
    adapter: { getBasePath: () => vaultRoot },
    getAbstractFileByPath: (filePath) => files.get(filePath) || null,
    createFolder: async (folderPath) => {
      createdFolders.push(folderPath);
      files.set(folderPath, { path: folderPath });
    },
    createBinary: async (filePath, buffer) => {
      writtenBinary = { filePath, byteLength: buffer.byteLength };
      const extension = path.extname(filePath).slice(1);
      const file = { path: filePath, extension };
      files.set(filePath, file);
      return file;
    },
    getResourcePath: (file) => `app://vault/${file.path}`,
  },
  workspace: {
    getLeaf: () => ({ openFile: async () => {} }),
  },
};
plugin.getEditorContext = () => ({ notePath: "Notes/source.md", selectedText: "", noteText: "" });

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

(async () => {
  const attachment = await plugin.saveImageFile({
    name: "diagram.png",
    type: "image/png",
    size: png.byteLength,
    arrayBuffer: async () => png.buffer,
  });

  assert.deepStrictEqual(createdFolders, ["_attachments", "_attachments/AI Workspace"]);
  assert.deepStrictEqual(writtenBinary, {
    filePath: "_attachments/AI Workspace/diagram.png",
    byteLength: png.byteLength,
  });
  assert.strictEqual(attachment.path, "_attachments/AI Workspace/diagram.png");
  assert.strictEqual(plugin.getImageResourcePath(attachment), "app://vault/_attachments/AI Workspace/diagram.png");

  const absoluteImage = path.resolve(vaultRoot, attachment.path);
  const originalExistsSync = require("fs").existsSync;
  require("fs").existsSync = (candidate) => candidate === absoluteImage || originalExistsSync(candidate);
  try {
    assert.deepStrictEqual(plugin.resolveImageAttachmentPaths([attachment]), [absoluteImage]);
  } finally {
    require("fs").existsSync = originalExistsSync;
  }

  const codex = plugin.getProviders().find((provider) => provider.id === "codex");
  const newArgs = codex.buildArgs([absoluteImage]);
  assert.deepStrictEqual(newArgs.slice(-3), ["--image", absoluteImage, "-"]);
  if (process.platform === "win32") {
    const configuredBase = path.join(vaultRoot, "fake-npm", "codex");
    const configuredCmd = `${configuredBase}.cmd`;
    const originalCodexPath = plugin.settings.codexPath;
    const originalCommandExistsSync = require("fs").existsSync;
    plugin.settings.codexPath = configuredBase;
    require("fs").existsSync = (candidate) => candidate === configuredCmd || originalCommandExistsSync(candidate);
    try {
      assert.strictEqual(plugin.getProviders().find((provider) => provider.id === "codex").command(), configuredCmd);
    } finally {
      plugin.settings.codexPath = originalCodexPath;
      require("fs").existsSync = originalCommandExistsSync;
    }
  }
  plugin.settings.sessions.codex = "00000000-0000-0000-0000-000000000001";
  const resumeArgs = codex.buildArgs([absoluteImage]);
  assert.ok(resumeArgs.includes("resume"));
  assert.ok(resumeArgs.includes("--image"));
  assert.ok(resumeArgs.includes(absoluteImage));

  const reclaude = plugin.getProviders().find((provider) => provider.id === "reclaude");
  const forkArgs = reclaude.buildArgs([], { sessionId: "parent-session", forkSession: true });
  assert.ok(forkArgs.includes("--resume"));
  assert.ok(forkArgs.includes("parent-session"));
  assert.ok(forkArgs.includes("--fork-session"));

  const parentConversation = {
    id: "claude-parent",
    providerId: "reclaude",
    title: "父对话",
    sessionId: "parent-session",
    providerThreadId: "parent-session",
    branchKind: "",
    branchDepth: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [
      { id: "claude-u1", role: "user", content: "问题", providerId: "reclaude", status: "completed" },
      { id: "claude-a1", role: "assistant", content: "回答", providerId: "reclaude", status: "completed" },
    ],
  };
  const nativeBranch = {
    ...parentConversation,
    id: "claude-native-branch",
    sessionId: null,
    providerThreadId: null,
    parentConversationId: parentConversation.id,
    branchKind: "pending",
    branchDepth: 1,
    messages: parentConversation.messages.map((message) => ({ ...message })),
  };
  plugin.settings.conversations.reclaude = [nativeBranch, parentConversation];
  plugin.settings.activeConversationIds.reclaude = nativeBranch.id;
  assert.deepStrictEqual(
    plugin.prepareCliConversationRun("reclaude", nativeBranch, nativeBranch.messages),
    { sessionId: "parent-session", forkSession: true },
  );

  const compatibleBranch = {
    ...nativeBranch,
    id: "claude-compatible-branch",
    messages: [parentConversation.messages[0]],
  };
  plugin.settings.conversations.reclaude = [compatibleBranch, parentConversation];
  plugin.settings.activeConversationIds.reclaude = compatibleBranch.id;
  const compatibleOptions = plugin.prepareCliConversationRun(
    "reclaude",
    compatibleBranch,
    compatibleBranch.messages,
  );
  assert.strictEqual(compatibleOptions.sessionId, null);
  assert.strictEqual(compatibleOptions.compatibleHistory[0].id, "claude-u1");
  assert.strictEqual(compatibleBranch.branchKind, "compatible");

  const prompt = plugin.buildPrompt("分析图片", {
    notePath: "Notes/source.md",
    selectedText: "",
    noteText: "",
    references: [],
    attachments: [attachment],
  });
  assert.match(prompt, /Read tool/);
  assert.match(prompt, /_attachments\/AI Workspace\/diagram\.png/);

  plugin.settings.conversations.codex = [
    {
      id: "conversation-1",
      title: "新对话",
      sessionId: null,
      model: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    },
  ];
  plugin.settings.activeConversationIds.codex = "conversation-1";
  await plugin.saveConversation("codex", [
    {
      role: "user",
      content: "分析图片",
      notePath: "Notes/source.md",
      providerId: "codex",
      model: "",
      meta: {},
      attachments: [attachment],
    },
  ]);
  assert.strictEqual(plugin.savedData.histories.codex[0].attachments[0].path, attachment.path);

  console.log("codex-chat image integration tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
