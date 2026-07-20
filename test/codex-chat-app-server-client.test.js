const assert = require("assert");
const { EventEmitter } = require("events");
const path = require("path");
const {
  CodexAppServerClient,
  CodexAppServerError,
  buildCodexThreadStartParams,
  buildCodexTurnStartParams,
  buildInjectedHistoryItems,
  mapCodexTurnsToMessages,
  parseCodexAppServerNotification,
  describeCodexTimelineItem,
  describeCodexApprovalRequest,
  prepareSpawnInvocation,
} = require("../codex-app-server-client");

const windowsNpmRoot = "C:\\Users\\tester\\AppData\\Roaming\\npm";
const windowsCodexShim = `${windowsNpmRoot}\\codex.cmd`;
const windowsCodexScript = `${windowsNpmRoot}\\node_modules\\@openai\\codex\\bin\\codex.js`;
const windowsNodeExe = "C:\\Program Files\\nodejs\\node.exe";
const normalizedWindowsFiles = new Set([
  windowsCodexShim,
  windowsCodexScript,
  windowsNodeExe,
].map((value) => path.win32.normalize(value).toLowerCase()));
const windowsExistsSync = (value) => normalizedWindowsFiles.has(path.win32.normalize(value).toLowerCase());
const windowsReadFileSync = (value) => {
  assert.strictEqual(path.win32.normalize(value).toLowerCase(), path.win32.normalize(windowsCodexShim).toLowerCase());
  return '"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*';
};

assert.deepStrictEqual(
  prepareSpawnInvocation(`${windowsNpmRoot}\\codex`, ["app-server", "--stdio"], {
    platform: "win32",
    pathApi: path.win32,
    env: { PATH: `${windowsNpmRoot};C:\\Program Files\\nodejs` },
    existsSync: windowsExistsSync,
    readFileSync: windowsReadFileSync,
  }),
  {
    command: windowsNodeExe,
    args: [windowsCodexScript, "app-server", "--stdio"],
  },
);

const threadParams = buildCodexThreadStartParams(
  { allowEdits: true, models: { codex: "gpt-test" } },
  "C:/vault",
);
assert.deepStrictEqual(threadParams, {
  cwd: "C:/vault",
  approvalPolicy: "on-request",
  sandbox: "workspace-write",
  model: "gpt-test",
});
assert.deepStrictEqual(
  buildCodexThreadStartParams(
    { allowEdits: false, models: { codex: "stale-setting" } },
    "C:/vault",
    "",
  ),
  {
    cwd: "C:/vault",
    approvalPolicy: "on-request",
    sandbox: "read-only",
  },
  "switching back to automatic must start a thread without the stale explicit model",
);

const turnParams = buildCodexTurnStartParams({
  threadId: "thread-1",
  prompt: "分析图片",
  imagePaths: ["C:/vault/image.png", "relative.png"],
  userMessageId: "message-1",
  settings: { allowEdits: false, models: { codex: "" } },
  vaultPath: "C:/vault",
});
assert.strictEqual(turnParams.threadId, "thread-1");
assert.deepStrictEqual(turnParams.input, [
  { type: "text", text: "分析图片" },
  { type: "localImage", path: "C:/vault/image.png" },
]);
assert.deepStrictEqual(turnParams.sandboxPolicy, { type: "readOnly" });

const switchedTurnParams = buildCodexTurnStartParams({
  threadId: "thread-1",
  prompt: "继续",
  imagePaths: [],
  userMessageId: "message-2",
  settings: { allowEdits: false, models: { codex: "stale-setting" } },
  model: "gpt-turn-snapshot",
  vaultPath: "C:/vault",
});
assert.strictEqual(switchedTurnParams.model, "gpt-turn-snapshot");

assert.deepStrictEqual(
  buildInjectedHistoryItems([
    { role: "user", content: "问题" },
    { role: "assistant", content: "回答" },
    { role: "system", content: "忽略" },
  ]),
  [
    { type: "message", role: "user", content: [{ type: "input_text", text: "问题" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "回答" }] },
  ],
);

const mappedMessages = mapCodexTurnsToMessages(
  [
    { id: "local-u1", role: "user", content: "问题" },
    { id: "local-a1", role: "assistant", content: "回答" },
  ],
  [
    {
      id: "turn-1",
      items: [
        { id: "provider-u1", type: "userMessage", clientId: "local-u1" },
        { id: "provider-a1", type: "agentMessage", text: "回答" },
      ],
    },
  ],
);
assert.strictEqual(mappedMessages[0].providerTurnId, "turn-1");
assert.strictEqual(mappedMessages[0].providerItemId, "provider-u1");
assert.strictEqual(mappedMessages[1].providerTurnId, "turn-1");
assert.strictEqual(mappedMessages[1].providerItemId, "provider-a1");

assert.deepStrictEqual(
  parseCodexAppServerNotification("item/agentMessage/delta", {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    delta: "你好",
  }),
  {
    kind: "agentMessageDelta",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    delta: "你好",
  },
);
assert.deepStrictEqual(
  parseCodexAppServerNotification("model/rerouted", {
    threadId: "thread-1",
    turnId: "turn-1",
    fromModel: "gpt-requested",
    toModel: "gpt-actual",
    reason: "highRiskCyberActivity",
  }),
  {
    kind: "modelRerouted",
    threadId: "thread-1",
    turnId: "turn-1",
    fromModel: "gpt-requested",
    model: "gpt-actual",
  },
);
assert.deepStrictEqual(
  parseCodexAppServerNotification("thread/tokenUsage/updated", {
    threadId: "thread-1",
    turnId: "turn-1",
    tokenUsage: {
      last: { inputTokens: 12, cachedInputTokens: 4, outputTokens: 8, totalTokens: 20 },
      total: { inputTokens: 12, cachedInputTokens: 4, outputTokens: 8, totalTokens: 20 },
    },
  }),
  {
    kind: "tokenUsageUpdated",
    threadId: "thread-1",
    turnId: "turn-1",
    usage: { inputTokens: 12, cachedInputTokens: 4, outputTokens: 8 },
  },
);
assert.strictEqual(parseCodexAppServerNotification("unknown", {}), null);
assert.deepStrictEqual(
  describeCodexApprovalRequest("item/commandExecution/requestApproval", {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "command-1",
    command: "git status",
    cwd: "C:/vault",
    reason: "查看状态",
  }),
  {
    title: "需要批准命令",
    content: "$ git status\n\ncwd: C:/vault\n\n原因: 查看状态",
    itemId: "command-1",
    threadId: "thread-1",
    turnId: "turn-1",
  },
);
assert.deepStrictEqual(
  parseCodexAppServerNotification("item/commandExecution/outputDelta", {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "command-1",
    delta: "done\n",
  }),
  {
    kind: "itemContentDelta",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "command-1",
    itemType: "commandExecution",
    delta: "done\n",
  },
);
assert.deepStrictEqual(
  describeCodexTimelineItem({
    id: "command-1",
    type: "commandExecution",
    command: "git status --short",
    cwd: "C:/vault",
    aggregatedOutput: " M note.md",
    status: "completed",
  }, true),
  {
    kind: "command",
    title: "命令 · git status --short",
    content: "cwd: C:/vault\n\n M note.md",
    status: "completed",
  },
);

class FakeStream extends EventEmitter {
  setEncoding() {}
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.killed = false;
    this.messages = [];
    this.stdin = {
      destroyed: false,
      write: (line) => {
        const message = JSON.parse(line);
        this.messages.push(message);
        if (message.method === "initialize") {
          queueMicrotask(() => this.respond(message.id, { userAgent: "fake-codex" }));
        }
      },
    };
  }

  respond(id, result) {
    this.stdout.emit("data", `${JSON.stringify({ id, result })}\n`);
  }

  notify(method, params) {
    this.stdout.emit("data", `${JSON.stringify({ method, params })}\n`);
  }

  request(id, method, params) {
    this.stdout.emit("data", `${JSON.stringify({ id, method, params })}\n`);
  }

  kill() {
    this.killed = true;
    this.emit("close", 0, null);
  }
}

(async () => {
  const child = new FakeChild();
  const spawnCalls = [];
  const client = new CodexAppServerClient({
    command: "fake-codex",
    cwd: "C:/vault",
    requestTimeoutMs: 1000,
    spawnImpl: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return child;
    },
  });

  const notifications = [];
  const errors = [];
  client.onNotification((method, params) => notifications.push({ method, params }));
  client.onError((error) => errors.push(error));
  client.onServerRequest(async (method, params) => {
    assert.strictEqual(method, "item/commandExecution/requestApproval");
    return { decision: params.command === "safe" ? "accept" : "decline" };
  });

  await client.start();
  assert.strictEqual(client.isRunning(), true);
  assert.strictEqual(spawnCalls.length, 1);
  assert.strictEqual(spawnCalls[0].command, "fake-codex");
  assert.deepStrictEqual(spawnCalls[0].args, ["app-server", "--stdio"]);
  assert.strictEqual(child.messages[0].method, "initialize");
  assert.strictEqual(child.messages[1].method, "initialized");

  const requestPromise = client.request("thread/list", { limit: 20 });
  const threadRequest = child.messages.at(-1);
  child.respond(threadRequest.id, { data: [{ id: "thread-1" }] });
  assert.deepStrictEqual(await requestPromise, { data: [{ id: "thread-1" }] });

  child.notify("turn/started", { threadId: "thread-1", turn: { id: "turn-1" } });
  assert.deepStrictEqual(notifications, [
    { method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } },
  ]);

  child.request(91, "item/commandExecution/requestApproval", { command: "safe" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(child.messages.at(-1), { id: 91, result: { decision: "accept" } });

  child.stdout.emit("data", "not-json\n");
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0] instanceof CodexAppServerError);

  const pending = client.request("thread/read", { threadId: "missing" }, { timeoutMs: 0 });
  child.emit("close", 2, null);
  await assert.rejects(pending, /已退出/);
  assert.strictEqual(client.isRunning(), false);

  const childWithoutHandler = new FakeChild();
  const clientWithoutHandler = new CodexAppServerClient({
    spawnImpl: () => childWithoutHandler,
    requestTimeoutMs: 1000,
  });
  await clientWithoutHandler.start();
  childWithoutHandler.request(92, "unknown/request", {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(childWithoutHandler.messages.at(-1).error.code, -32601);
  await clientWithoutHandler.stop();
  assert.strictEqual(childWithoutHandler.killed, true);

  console.log("codex-chat app-server client tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
