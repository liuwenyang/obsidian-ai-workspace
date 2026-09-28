// Local-only browser fixture: actual runtime + CSS, fake Obsidian host, no CLI/provider calls.
// Run `node test/quote-ui-preview.js`, then open the printed URL with Playwright.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

function installHost() {
  const prototype = HTMLElement.prototype;
  prototype.createEl = function(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text) element.textContent = options.text;
    if (options.value !== undefined) element.value = options.value;
    for (const [key, value] of Object.entries(options.attr || {})) element.setAttribute(key, value);
    this.append(element);
    return element;
  };
  prototype.createDiv = function(options) { return this.createEl("div", options); };
  prototype.createSpan = function(options) { return this.createEl("span", options); };
  prototype.empty = function() { this.replaceChildren(); };
  prototype.setText = function(text) { this.textContent = text; };
  prototype.setAttr = function(name, value) { this.setAttribute(name, value); };
  // Match Obsidian's HTMLElement API; there is no module-level setCssProps export.
  prototype.setCssProps = function(props) {
    Object.entries(props).forEach(([key, value]) => this.style.setProperty(key, value));
  };
  prototype.addClass = function(name) { this.classList.add(name); };
  prototype.removeClass = function(name) { this.classList.remove(name); };
  prototype.toggleClass = function(name, enabled) { this.classList.toggle(name, enabled); };
  const host = {
    ItemView: class {
      constructor() { this.contentEl = document.querySelector("#workspace"); this.app = { workspace: { on() {} } }; }
      registerDomEvent(element, name, listener, options) { element.addEventListener(name, listener, options); }
      registerEvent() {} register() {} registerInterval() {}
    },
    MarkdownRenderer: { render: async (_app, text, body) => {
      text.split("\n\n").forEach((part) => body.createEl("p", { text: part }));
    } },
    Plugin: class {}, PluginSettingTab: class {}, Modal: class {},
    Notice: class { constructor(text) { document.querySelector("#notice").textContent = text; } },
    setIcon: (element, name) => element.setText(({ "text-quote": "❞", x: "×", "arrow-up": "↑", "messages-square": "◇" })[name] || "·"),
  };
  window.require = (name) => name === "obsidian" ? host : {};
  window.module = { exports: {} };
}

async function openWorkspace() {
  const provider = { id: "codex", shortLabel: "Codex", label: "Codex", available: true, models: [{ value: "", label: "自动" }] };
  const messages = [
    { id: "user-1", role: "user", content: "帮我比较测量误差与测量的不确定性。", providerId: "codex" },
    { id: "assistant-1", role: "assistant", providerId: "codex", content: "测量的不确定性用于描述测量结果的分散程度。选中这段文字，可以把它加入引用。\n\n测量误差是真值与测量值的差异。这里可以选择第二个独立片段，与前一个片段一起提问。\n\n保留问题草稿，再选取下一段内容。" },
    { id: "assistant-2", role: "assistant", providerId: "codex", content: "多处引用可以来自不同的消息。加入以后用淡色标记，问题仍然独立输入。\n\n这里还有一个很长的说明段落，用来确认窄窗口中的引用卡片可以正常换行，并且能够展开查看完整内容，而不遮挡输入框，也不需要把很长的原文直接填进输入框。" },
  ];
  const plugin = {
    settings: { models: { codex: "" }, maxContextChars: 2000 },
    ensureActiveProvider: () => "codex", getHistory: () => messages,
    getProvider: () => provider, getAvailableProviders: () => [provider],
    getActiveConversation: () => ({ id: "fixture", title: "多处选文引用预览" }), getConversations: () => [],
    getModelLabel: () => "自动", getEditorContext: () => ({ notePath: "" }),
    resolveImageAttachmentPaths: () => [], prepareCliConversationRun: () => ({}),
    getReferencedNotes: async () => [], saveConversation: async () => {}, buildPrompt: (text) => text,
  };
  window.view = new window.WorkspaceView({}, plugin);
  window.view.startCodexAppServerRun = async (run, prompt) => {
    window.sentPrompt = prompt;
    run.running = false;
    window.view.setRunning(false, "测试消息已保存（未调用模型）");
  };
  await window.view.onOpen();
}

const page = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>多处引用 UI 验证</title>
<link rel="stylesheet" href="/styles.css"><style>
:root { --interactive-accent:#9d83ef; --text-accent:#a995ef; --text-normal:#dedede; --text-muted:#aaa;
--text-faint:#858585; --background-primary:#202020; --background-secondary:#292929; --background-modifier-border:#414141;
font-family:system-ui; color-scheme:dark; } * {box-sizing:border-box} body {margin:0;background:#181818}
#workspace {height:100vh;width:min(460px,100vw);margin:auto} button,select,textarea {font-family:inherit;color:var(--text-normal)}
button {border:0;border-radius:5px;background:#333;cursor:pointer} textarea {background:transparent}
#notice {position:fixed;bottom:0;left:0;color:#aaa;font-size:10px;pointer-events:none}
.status-bar {position:fixed;bottom:0;right:0;background:#222;font-size:10px;color:#999;padding:3px 8px}
body.light {--interactive-accent:#7653c1;--text-accent:#7653c1;--text-normal:#252525;--text-muted:#666;
--text-faint:#777;--background-primary:#fff;--background-secondary:#f4f3f6;--background-modifier-border:#ddd;color-scheme:light}
</style><main id="workspace"></main><div id="notice"></div><div class="status-bar">0 条反向链接</div>
<script>(${installHost.toString()})();</script><script src="/main.js"></script><script>(${openWorkspace.toString()})();</script></html>`;

const server = http.createServer((request, response) => {
  if (request.url === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(page);
  } else if (request.url === "/main.js" || request.url === "/styles.css") {
    response.setHeader("Content-Type", request.url.endsWith("js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8");
    const source = fs.readFileSync(path.join(__dirname, "..", request.url.slice(1)), "utf8");
    response.end(source + (request.url.endsWith("js") ? "\nwindow.WorkspaceView = AgentWorkspaceView;" : ""));
  } else { response.writeHead(404); response.end(); }
});
server.listen(0, "127.0.0.1", () => console.log(`Quote UI fixture: http://127.0.0.1:${server.address().port}`));
