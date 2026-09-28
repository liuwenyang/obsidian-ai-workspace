const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const nodeTimers = require("node:timers");

function resolveExecutableCommand(command, options = {}) {
  const platform = options.platform || process.platform;
  const pathApi = options.pathApi || (platform === "win32" ? path.win32 : path);
  const existsSync = options.existsSync || fs.existsSync;
  const value = String(command || "").trim();
  if (!value || platform !== "win32" || pathApi.extname(value)) return value;
  for (const extension of [".exe", ".com", ".cmd", ".bat"]) {
    const candidate = `${value}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  return value;
}

function findSpawnableOnPath(commandName, options = {}) {
  const platform = options.platform || process.platform;
  const pathApi = options.pathApi || (platform === "win32" ? path.win32 : path);
  const existsSync = options.existsSync || fs.existsSync;
  const env = options.env || process.env;
  const envPath = env.PATH || env.Path || env.path || "";
  if (!commandName || !envPath) return "";
  const names = platform === "win32" && !pathApi.extname(commandName)
    ? [".exe", ".com", ".cmd", ".bat"].map((extension) => `${commandName}${extension}`)
    : [commandName];
  for (const rawDirectory of envPath.split(pathApi.delimiter)) {
    const directory = rawDirectory.trim().replace(/^"(.*)"$/, "$1");
    if (!directory) continue;
    for (const name of names) {
      const candidate = pathApi.join(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "";
}

function resolveNpmShimScript(shimPath, options = {}) {
  const platform = options.platform || process.platform;
  const pathApi = options.pathApi || (platform === "win32" ? path.win32 : path);
  const existsSync = options.existsSync || fs.existsSync;
  const readFileSync = options.readFileSync || fs.readFileSync;
  try {
    const source = readFileSync(shimPath, "utf8");
    const match = source.match(/%dp0%[\\/]+([^"\r\n]+?\.(?:cjs|mjs|js))"/i);
    if (!match) return "";
    const base = pathApi.dirname(shimPath);
    const relativeScript = match[1].split(/[\\/]+/).join(pathApi.sep);
    const scriptPath = pathApi.resolve(base, relativeScript);
    const boundary = pathApi.relative(base, scriptPath);
    if (!boundary || boundary.startsWith("..") || pathApi.isAbsolute(boundary)) return "";
    return existsSync(scriptPath) ? scriptPath : "";
  } catch {
    return "";
  }
}

function prepareSpawnInvocation(command, args = [], options = {}) {
  const platform = options.platform || process.platform;
  const pathApi = options.pathApi || (platform === "win32" ? path.win32 : path);
  const existsSync = options.existsSync || fs.existsSync;
  const rawCommand = String(command || "").trim();
  const commandFromPath = platform === "win32" && !pathApi.isAbsolute(rawCommand) && !/[\\/]/.test(rawCommand)
    ? findSpawnableOnPath(rawCommand, options)
    : "";
  const resolvedCommand = resolveExecutableCommand(commandFromPath || rawCommand, options);
  const normalizedArgs = Array.isArray(args) ? [...args] : [];
  if (platform !== "win32" || ![".cmd", ".bat"].includes(pathApi.extname(resolvedCommand).toLowerCase())) {
    return { command: resolvedCommand, args: normalizedArgs };
  }

  // npm's Windows .cmd files are shell wrappers. Execute their JavaScript
  // entry point with node.exe so stdio remains attached to app-server and no
  // command shell needs to parse user-controlled file paths.
  const scriptPath = resolveNpmShimScript(resolvedCommand, options);
  const adjacentNode = pathApi.join(pathApi.dirname(resolvedCommand), "node.exe");
  const nodeCommand = existsSync(adjacentNode) ? adjacentNode : findSpawnableOnPath("node", options);
  if (scriptPath && nodeCommand && [".exe", ".com"].includes(pathApi.extname(nodeCommand).toLowerCase())) {
    return { command: nodeCommand, args: [scriptPath, ...normalizedArgs] };
  }
  throw new Error(`无法安全启动 Windows 命令脚本：${resolvedCommand}`);
}

function buildCodexThreadStartParams(settings, vaultPath, modelOverride) {
  const params = {
    cwd: vaultPath,
    approvalPolicy: "on-request",
    sandbox: settings && settings.allowEdits ? "workspace-write" : "read-only",
  };
  const model = typeof modelOverride === "string"
    ? modelOverride
    : settings && settings.models && settings.models.codex;
  if (model) params.model = model;
  return params;
}

function buildCodexTurnStartParams({ threadId, prompt, imagePaths, userMessageId, settings, model, vaultPath }) {
  const input = [{ type: "text", text: String(prompt || "") }];
  for (const imagePath of Array.isArray(imagePaths) ? imagePaths : []) {
    if (typeof imagePath === "string" && path.isAbsolute(imagePath)) {
      input.push({ type: "localImage", path: imagePath });
    }
  }
  const allowEdits = Boolean(settings && settings.allowEdits);
  const params = {
    threadId,
    clientUserMessageId: userMessageId,
    input,
    cwd: vaultPath,
    approvalPolicy: "on-request",
    sandboxPolicy: allowEdits
      ? { type: "workspaceWrite", writableRoots: [vaultPath], networkAccess: false }
      : { type: "readOnly" },
  };
  const selectedModel = typeof model === "string" ? model : settings && settings.models && settings.models.codex;
  if (selectedModel) params.model = selectedModel;
  const effort = settings && settings.efforts && settings.efforts.codex;
  if (typeof effort === "string" && effort) params.effort = effort;
  if (settings && settings.codexFastMode) params.serviceTier = "priority";
  return params;
}

const STALE_CODEX_THREAD_PATTERN = /paginated_threads is not supported|no rollout found|thread not found|thread_not_found/i;

function isStaleCodexThreadError(error) {
  const text = error instanceof Error ? error.message : String(error || "");
  return STALE_CODEX_THREAD_PATTERN.test(text);
}

function buildInjectedHistoryItems(messages) {
  const items = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") continue;
    const text = message.content.trim();
    if (!text) continue;
    items.push({
      type: "message",
      role: message.role,
      content: [
        {
          type: message.role === "assistant" ? "output_text" : "input_text",
          text,
        },
      ],
    });
  }
  return items;
}

function mapCodexTurnsToMessages(messages, turns) {
  const output = Array.isArray(messages) ? messages.map((message) => ({ ...message })) : [];
  const byId = new Map(output.map((message, index) => [message.id, index]));
  let userCursor = 0;
  let assistantCursor = 0;
  const nextRoleIndex = (role, cursor) => {
    for (let index = cursor; index < output.length; index += 1) {
      if (output[index].role === role && !output[index].providerTurnId) return index;
    }
    return -1;
  };
  for (const turn of Array.isArray(turns) ? turns : []) {
    if (!turn || typeof turn.id !== "string") continue;
    const items = Array.isArray(turn.items) ? turn.items : [];
    const userItem = items.find((item) => item && item.type === "userMessage");
    if (userItem) {
      let index = userItem.clientId && byId.has(userItem.clientId) ? byId.get(userItem.clientId) : -1;
      if (index < 0) index = nextRoleIndex("user", userCursor);
      if (index >= 0) {
        output[index].providerTurnId = turn.id;
        output[index].providerItemId = userItem.id || null;
        userCursor = index + 1;
      }
    }
    for (const item of items.filter((candidate) => candidate && candidate.type === "agentMessage")) {
      const index = nextRoleIndex("assistant", assistantCursor);
      if (index < 0) break;
      output[index].providerTurnId = turn.id;
      output[index].providerItemId = item.id || null;
      assistantCursor = index + 1;
    }
  }
  return output;
}

/**
 * Convert versioned app-server notifications into a small stable action set.
 * Keeping protocol spelling here prevents the Obsidian view from depending on
 * every JSON shape exposed by a particular Codex release.
 */
function parseCodexAppServerNotification(method, paramsValue) {
  const params = paramsValue && typeof paramsValue === "object" ? paramsValue : {};
  const threadId = typeof params.threadId === "string" ? params.threadId : "";
  const turnId = typeof params.turnId === "string"
    ? params.turnId
    : params.turn && typeof params.turn.id === "string"
      ? params.turn.id
      : "";
  if (method === "turn/started" && threadId && turnId) {
    return { kind: "turnStarted", threadId, turnId, turn: params.turn };
  }
  if (method === "turn/completed" && threadId && turnId) {
    return { kind: "turnCompleted", threadId, turnId, turn: params.turn };
  }
  if (method === "item/started" && threadId && turnId && params.item) {
    return { kind: "itemStarted", threadId, turnId, item: params.item };
  }
  if (method === "item/completed" && threadId && turnId && params.item) {
    return { kind: "itemCompleted", threadId, turnId, item: params.item };
  }
  if (method === "item/agentMessage/delta" && threadId && turnId && typeof params.itemId === "string") {
    return {
      kind: "agentMessageDelta",
      threadId,
      turnId,
      itemId: params.itemId,
      delta: typeof params.delta === "string" ? params.delta : "",
    };
  }
  const itemDeltaTypes = {
    "item/plan/delta": "plan",
    "item/commandExecution/outputDelta": "commandExecution",
    "item/fileChange/outputDelta": "fileChange",
    "item/reasoning/summaryTextDelta": "reasoning",
    "item/reasoning/textDelta": "reasoning",
  };
  if (itemDeltaTypes[method] && threadId && turnId && typeof params.itemId === "string") {
    return {
      kind: "itemContentDelta",
      threadId,
      turnId,
      itemId: params.itemId,
      itemType: itemDeltaTypes[method],
      delta: typeof params.delta === "string" ? params.delta : "",
    };
  }
  if (method === "item/mcpToolCall/progress" && threadId && turnId && typeof params.itemId === "string") {
    return {
      kind: "itemContentDelta",
      threadId,
      turnId,
      itemId: params.itemId,
      itemType: "mcpToolCall",
      delta: typeof params.message === "string" ? `${params.message}\n` : "",
    };
  }
  if (method === "item/fileChange/patchUpdated" && threadId && turnId && typeof params.itemId === "string") {
    return {
      kind: "fileChangePatchUpdated",
      threadId,
      turnId,
      itemId: params.itemId,
      changes: Array.isArray(params.changes) ? params.changes : [],
    };
  }
  if (method === "turn/diff/updated" && threadId && turnId) {
    return { kind: "turnDiffUpdated", threadId, turnId, diff: String(params.diff || "") };
  }
  if (method === "thread/tokenUsage/updated" && threadId && turnId) {
    const usage = params.tokenUsage && typeof params.tokenUsage === "object" ? params.tokenUsage : {};
    const last = usage.last && typeof usage.last === "object" ? usage.last : {};
    return {
      kind: "tokenUsageUpdated",
      threadId,
      turnId,
      usage: {
        inputTokens: Number(last.inputTokens || 0),
        cachedInputTokens: Number(last.cachedInputTokens || 0),
        outputTokens: Number(last.outputTokens || 0),
      },
    };
  }
  if (method === "model/rerouted" && threadId && turnId && typeof params.toModel === "string") {
    return {
      kind: "modelRerouted",
      threadId,
      turnId,
      fromModel: typeof params.fromModel === "string" ? params.fromModel : "",
      model: params.toModel,
    };
  }
  if (method === "error" || method === "warning") {
    const error = params.error && typeof params.error === "object" ? params.error : {};
    return {
      kind: method === "error" ? "error" : "warning",
      threadId,
      turnId,
      message: String(error.message || params.message || `${method === "error" ? "Codex 错误" : "Codex 警告"}`),
    };
  }
  return null;
}

function codexDisplayText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, 80000);
  try {
    return JSON.stringify(value, null, 2).slice(0, 80000);
  } catch {
    return String(value).slice(0, 80000);
  }
}

function codexItemStatus(value, completed) {
  const status = String(value || "").toLowerCase();
  if (status.includes("fail") || status.includes("declin") || status.includes("denied")) return "failed";
  if (status.includes("interrupt")) return "interrupted";
  if (completed || status.includes("complete") || status.includes("success")) return "completed";
  return "running";
}

/** Build the persistent presentation model for non-chat Codex thread items. */
function describeCodexTimelineItem(itemValue, completed = false) {
  const item = itemValue && typeof itemValue === "object" ? itemValue : {};
  const status = codexItemStatus(item.status, completed);
  if (item.type === "reasoning") {
    return {
      kind: "reasoning",
      title: "思考过程",
      content: [...(Array.isArray(item.summary) ? item.summary : []), ...(Array.isArray(item.content) ? item.content : [])]
        .filter(Boolean)
        .join("\n\n"),
      status,
    };
  }
  if (item.type === "plan") {
    return { kind: "plan", title: "执行计划", content: codexDisplayText(item.text), status };
  }
  if (item.type === "commandExecution") {
    const detail = [item.cwd ? `cwd: ${codexDisplayText(item.cwd)}` : "", codexDisplayText(item.aggregatedOutput)]
      .filter(Boolean)
      .join("\n\n");
    return { kind: "command", title: `命令 · ${item.command || "执行"}`, content: detail, status };
  }
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const content = changes
      .map((change) => `${change.kind || "update"} ${change.path || ""}\n${change.diff || ""}`.trim())
      .join("\n\n");
    return { kind: "fileChange", title: `文件变更${changes.length ? ` · ${changes.length} 个文件` : ""}`, content, status };
  }
  if (item.type === "mcpToolCall") {
    const content = [
      item.arguments !== undefined ? `参数\n${codexDisplayText(item.arguments)}` : "",
      item.result !== undefined && item.result !== null ? `结果\n${codexDisplayText(item.result)}` : "",
      item.error ? `错误\n${codexDisplayText(item.error)}` : "",
    ].filter(Boolean).join("\n\n");
    return { kind: "tool", title: `MCP · ${item.server || "server"}/${item.tool || "tool"}`, content, status };
  }
  if (item.type === "dynamicToolCall") {
    const content = [
      item.arguments !== undefined ? `参数\n${codexDisplayText(item.arguments)}` : "",
      item.contentItems ? `结果\n${codexDisplayText(item.contentItems)}` : "",
    ].filter(Boolean).join("\n\n");
    const toolName = [item.namespace, item.tool].filter(Boolean).join("/") || "工具";
    return { kind: "tool", title: `工具 · ${toolName}`, content, status };
  }
  if (item.type === "collabAgentToolCall") {
    const content = [item.prompt, codexDisplayText(item.agentsStates)].filter(Boolean).join("\n\n");
    return { kind: "tool", title: `协作任务 · ${codexDisplayText(item.tool) || "agent"}`, content, status };
  }
  if (item.type === "subAgentActivity") {
    return {
      kind: "tool",
      title: `子任务 · ${item.agentPath || item.agentThreadId || "agent"}`,
      content: codexDisplayText(item.kind),
      status,
    };
  }
  if (item.type === "webSearch") {
    return { kind: "webSearch", title: `网页搜索 · ${item.query || ""}`.trim(), content: codexDisplayText(item.action), status };
  }
  if (item.type === "imageView") {
    return { kind: "tool", title: "查看图片", content: codexDisplayText(item.path), status };
  }
  if (item.type === "imageGeneration") {
    return { kind: "tool", title: "生成图片", content: codexDisplayText(item.savedPath || item.result), status };
  }
  if (item.type === "contextCompaction") {
    return { kind: "reasoning", title: "压缩上下文", content: "Codex 已整理当前会话上下文。", status };
  }
  return null;
}

function describeCodexApprovalRequest(method, paramsValue) {
  const params = paramsValue && typeof paramsValue === "object" ? paramsValue : {};
  if (method === "item/commandExecution/requestApproval") {
    const content = [
      params.command ? `$ ${params.command}` : "",
      params.cwd ? `cwd: ${codexDisplayText(params.cwd)}` : "",
      params.reason ? `原因: ${params.reason}` : "",
    ].filter(Boolean).join("\n\n");
    return { title: "需要批准命令", content, itemId: params.itemId || "", threadId: params.threadId || "", turnId: params.turnId || "" };
  }
  if (method === "item/fileChange/requestApproval") {
    const content = [
      params.grantRoot ? `写入范围: ${codexDisplayText(params.grantRoot)}` : "",
      params.reason ? `原因: ${params.reason}` : "",
    ].filter(Boolean).join("\n\n");
    return { title: "需要批准文件变更", content, itemId: params.itemId || "", threadId: params.threadId || "", turnId: params.turnId || "" };
  }
  return null;
}

class CodexAppServerError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "CodexAppServerError";
    this.code = details.code;
    this.data = details.data;
  }
}

/**
 * Minimal JSON-RPC client for `codex app-server --stdio`.
 *
 * Codex omits the `jsonrpc` field and carries one JSON object per line. This
 * client deliberately knows nothing about Obsidian or conversation storage so
 * process/protocol behavior can be exercised with a fake child process.
 */
class CodexAppServerClient {
  constructor(options = {}) {
    this.command = options.command || "codex";
    this.args = Array.isArray(options.args) ? options.args : ["app-server", "--stdio"];
    this.cwd = options.cwd || process.cwd();
    this.env = options.env || process.env;
    this.spawnImpl = options.spawnImpl || spawn;
    this.clientInfo = {
      name: "obsidian_ai_workspace",
      title: "AI Workspace for Obsidian",
      version: "0.7.0",
      ...(options.clientInfo || {}),
    };
    this.capabilities = options.capabilities && typeof options.capabilities === "object"
      ? options.capabilities
      : {};
    this.requestTimeoutMs = Number.isFinite(Number(options.requestTimeoutMs))
      ? Math.max(100, Number(options.requestTimeoutMs))
      : 30000;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.notificationListeners = new Set();
    this.errorListeners = new Set();
    this.serverRequestHandler = null;
    this.startPromise = null;
    this.initialized = false;
    this.stopping = false;
  }

  isRunning() {
    return Boolean(this.child && this.initialized && !this.stopping);
  }

  onNotification(listener) {
    if (typeof listener !== "function") return () => {};
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onError(listener) {
    if (typeof listener !== "function") return () => {};
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onServerRequest(handler) {
    this.serverRequestHandler = typeof handler === "function" ? handler : null;
  }

  emitError(error) {
    for (const listener of this.errorListeners) {
      try {
        listener(error);
      } catch {
        // A diagnostic listener must not break the protocol loop.
      }
    }
  }

  async start() {
    if (this.isRunning()) return this;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
      return this;
    } finally {
      this.startPromise = null;
    }
  }

  async startInternal() {
    this.stopping = false;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    let child;
    try {
      const invocation = prepareSpawnInvocation(this.command, this.args, { env: this.env });
      child = this.spawnImpl(invocation.command, invocation.args, {
        cwd: this.cwd,
        env: this.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      throw new CodexAppServerError(`无法启动 Codex app-server：${error.message || error}`);
    }
    this.child = child;
    if (child.stdout && typeof child.stdout.setEncoding === "function") child.stdout.setEncoding("utf8");
    if (child.stderr && typeof child.stderr.setEncoding === "function") child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.consumeStdout(String(chunk)));
    child.stderr.on("data", (chunk) => {
      this.stderrBuffer = (this.stderrBuffer + String(chunk)).slice(-16000);
    });
    child.on("error", (error) => this.handleExit(error));
    child.on("close", (code, signal) => {
      const detail = signal ? `信号 ${signal}` : `退出码 ${code}`;
      this.handleExit(new CodexAppServerError(`Codex app-server 已退出（${detail}）`));
    });

    await this.request("initialize", {
      clientInfo: this.clientInfo,
      capabilities: this.capabilities,
    });
    this.notify("initialized", {});
    this.initialized = true;
  }

  request(method, params = {}, options = {}) {
    if (!this.child || this.stopping) {
      return Promise.reject(new CodexAppServerError("Codex app-server 尚未启动"));
    }
    const id = this.nextId;
    this.nextId += 1;
    const timeoutMs = Number.isFinite(Number(options.timeoutMs))
      ? Math.max(0, Number(options.timeoutMs))
      : this.requestTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0
        ? nodeTimers.setTimeout(() => {
            this.pending.delete(id);
            reject(new CodexAppServerError(`Codex app-server 请求超时：${method}`));
          }, timeoutMs)
        : null;
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.writeMessage({ method, id, params });
      } catch (error) {
        if (timer) nodeTimers.clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    if (!this.child || this.stopping) throw new CodexAppServerError("Codex app-server 尚未启动");
    this.writeMessage({ method, params });
  }

  writeMessage(message) {
    if (!this.child || !this.child.stdin || this.child.stdin.destroyed) {
      throw new CodexAppServerError("Codex app-server 输入流不可用");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  consumeStdout(chunk) {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.emitError(new CodexAppServerError(`Codex app-server 返回无效 JSON：${line.slice(0, 300)}`));
        continue;
      }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (!message || typeof message !== "object") return;
    if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (pending.timer) nodeTimers.clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new CodexAppServerError(
            message.error.message || `Codex app-server 请求失败：${pending.method}`,
            message.error,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method && Object.prototype.hasOwnProperty.call(message, "id")) {
      void this.handleServerRequest(message);
      return;
    }

    if (message.method) {
      for (const listener of this.notificationListeners) {
        try {
          listener(message.method, message.params || {});
        } catch (error) {
          this.emitError(error);
        }
      }
    }
  }

  async handleServerRequest(message) {
    if (!this.serverRequestHandler) {
      this.writeMessage({
        id: message.id,
        error: { code: -32601, message: `客户端尚未处理请求：${message.method}` },
      });
      return;
    }
    try {
      const result = await this.serverRequestHandler(message.method, message.params || {});
      this.writeMessage({ id: message.id, result: result === undefined ? {} : result });
    } catch (error) {
      try {
        this.writeMessage({
          id: message.id,
          error: { code: -32000, message: error.message || String(error) },
        });
      } catch (responseError) {
        this.emitError(responseError);
      }
    }
  }

  handleExit(error) {
    if (!this.child && !this.initialized) return;
    this.child = null;
    this.initialized = false;
    const suffix = this.stderrBuffer.trim();
    const failure = suffix
      ? new CodexAppServerError(`${error.message || error}\n${suffix}`)
      : error instanceof Error
        ? error
        : new CodexAppServerError(String(error));
    for (const pending of this.pending.values()) {
      if (pending.timer) nodeTimers.clearTimeout(pending.timer);
      pending.reject(failure);
    }
    this.pending.clear();
    if (!this.stopping) this.emitError(failure);
  }

  async stop() {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.initialized = false;
    for (const pending of this.pending.values()) {
      if (pending.timer) nodeTimers.clearTimeout(pending.timer);
      pending.reject(new CodexAppServerError("Codex app-server 已停止"));
    }
    this.pending.clear();
    if (child && !child.killed && typeof child.kill === "function") child.kill("SIGTERM");
    this.stopping = false;
  }
}

module.exports = {
  CodexAppServerClient,
  CodexAppServerError,
  buildCodexThreadStartParams,
  buildCodexTurnStartParams,
  buildInjectedHistoryItems,
  isStaleCodexThreadError,
  mapCodexTurnsToMessages,
  parseCodexAppServerNotification,
  describeCodexTimelineItem,
  describeCodexApprovalRequest,
  prepareSpawnInvocation,
};
