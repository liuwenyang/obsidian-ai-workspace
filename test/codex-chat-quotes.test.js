const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Load the actual self-contained runtime, exposing the view only in this sandbox.
const notices = [];
const obsidian = {
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, Modal: class {},
  Notice: class { constructor(text) { notices.push(text); } },
  setIcon() {},
};
const sandbox = { module: { exports: {} }, require: (name) => name === "obsidian" ? obsidian : require(name) };
vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, "../main.js"), "utf8")}\nmodule.exports.View = AgentWorkspaceView;`, sandbox);
const View = sandbox.module.exports.View;

class Element {
  constructor() { this.children = []; this.value = ""; this.style = { removeProperty() {} }; }
  createEl(tag, options = {}) {
    const element = new Element();
    Object.assign(element, { tag, text: options.text, attrs: options.attr, cls: options.cls });
    this.children.push(element);
    return element;
  }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  setText(text) { this.text = text; }
  setAttr(name, value) { (this.attrs ||= {})[name] = value; }
  setCssProps(props) { this.cssProps = { ...this.cssProps, ...props }; }
  empty() { this.children = []; }
  addEventListener(name, callback) { (this.events ||= {})[name] = callback; }
  toggleClass() {}
  focus() { this.focused = true; }
  contains(node) { return node?.connected; }
}

function createView() {
  const provider = { id: "codex", shortLabel: "Codex", available: true };
  const plugin = {
    settings: { includeCurrentNote: false, models: { codex: "" }, maxContextChars: 2000 },
    ensureActiveProvider: () => "codex", getHistory: () => [], getProvider: () => provider,
    getActiveConversation: () => ({ id: "conversation-1" }),
    resolveImageAttachmentPaths: () => [], prepareCliConversationRun: () => ({}),
    getReferencedNotes: async () => [], saveConversation: async () => {},
    buildPrompt: (text) => text,
    persist: async () => {}, syncActiveConversationState() {},
    createNewConversation: async () => ({ messages: [] }),
    activateConversation: async () => ({ messages: [] }),
    createConversationBranch: async () => ({ messages: [] }),
  };
  const view = new View({}, plugin);
  for (const name of ["contentEl", "messagesEl", "quoteStripEl", "quoteAnnouncementEl", "quoteButton", "inputEl", "hintEl",
    "sendButton", "providerSelect", "modelSelect", "stopButton", "statusEl"]) view[name] = new Element();
  const registry = new Map();
  view.contentEl.ownerDocument = {
    defaultView: { CSS: { highlights: registry }, Highlight: Set },
    getSelection: () => ({ removeAllRanges() {} }),
  };
  for (const name of ["appendMessage", "updateConversationChrome", "renderModelSelect", "renderHistory", "updateContextBar"]) view[name] = () => {};
  view.startCodexAppServerRun = async (run, prompt) => { view.sentPrompt = prompt; };
  return view;
}

function candidate(text, messageId = "message-1", offset = 0) {
  return { text, messageId, offset, source: "Codex · 消息 1", rangeText: text,
    range: { commonAncestorContainer: { connected: true }, toString: () => text } };
}

function add(view, quote) { view.selectedQuote = quote; view.quoteSelectedText(); }

(async () => {
  const positioned = createView();
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  Object.assign(positioned.contentEl, {
    getBoundingClientRect: () => rect(200, 80, 800, 700),
    offsetWidth: 800, offsetHeight: 700, clientLeft: 0, clientTop: 0, scrollLeft: 0, scrollTop: 0,
  });
  positioned.messagesEl.getBoundingClientRect = () => rect(210, 140, 780, 500);
  Object.assign(positioned.quoteButton, { offsetWidth: 120, offsetHeight: 30 });
  const place = (...rects) => {
    positioned.selectedQuote = { range: { getClientRects: () => rects } };
    positioned.positionQuoteSelection();
    return positioned.quoteButton.cssProps;
  };
  // In a real Obsidian host the previous module-level call would throw, leaving
  // both variables unset and displaying the CSS fallback at the panel origin.
  assert.deepEqual(place(rect(600, 430, 40, 20)), { "--quote-left": "446px", "--quote-top": "313px" });
  assert.deepEqual(place(rect(930, 430, 40, 20)), { "--quote-left": "662px", "--quote-top": "313px" }, "right edge stays in pane");
  assert.deepEqual(place(rect(600, 145, 40, 20)), { "--quote-left": "446px", "--quote-top": "92px" }, "top edge flips below");
  assert.deepEqual(place(rect(400, 400, 80, 20), rect(600, 430, 40, 20)), { "--quote-left": "446px", "--quote-top": "313px" }, "last visible line is the anchor");
  place(rect(600, 100, 40, 20));
  assert.equal(positioned.quoteButton.hidden, true, "offscreen selections hide the button");
  Object.assign(positioned.contentEl, {
    getBoundingClientRect: () => rect(200, 80, 1000, 875), clientLeft: 2, clientTop: 2,
  });
  positioned.messagesEl.getBoundingClientRect = () => rect(212.5, 155, 975, 625);
  assert.deepEqual(place(rect(700, 517.5, 50, 25)), { "--quote-left": "444px", "--quote-top": "311px" }, "scaled/bordered panes use local CSS pixels");
  positioned.messagesEl.getBoundingClientRect = () => rect(210, 140, 100, 20);
  place(rect(215, 145, 40, 10));
  assert.equal(positioned.quoteButton.hidden, true, "do not float outside a collapsed pane");

  positioned.contentEl.ownerDocument.querySelector = () => null;
  positioned.syncStatusBarClearance();
  assert.equal(positioned.contentEl.cssProps["--codex-chat-status-bar-clearance"], "0px");
  positioned.contentEl.ownerDocument.querySelector = () => ({ getBoundingClientRect: () => rect(200, 935, 1000, 20) });
  positioned.contentEl.ownerDocument.defaultView.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  positioned.syncStatusBarClearance();
  assert.equal(positioned.contentEl.cssProps["--codex-chat-status-bar-clearance"], "28px");

  const view = createView();
  view.inputEl.value = "请对比这几处内容";
  add(view, candidate("第一段\n第二行"));
  add(view, candidate("另一个片段", "message-2"));
  assert.equal(view.draftQuotes.length, 2);
  assert.equal(view.inputEl.value, "请对比这几处内容", "collecting must not modify the draft");
  assert.ok(!view.inputEl.focused, "collecting must not jump to the composer");
  assert.equal(view.quoteStripEl.hidden, false);
  assert.equal(view.quoteStripEl.children[0].children[0].text, "引用 2 处");
  assert.equal(view.contentEl.ownerDocument.defaultView.CSS.highlights.get("codex-chat-quotes").size, 2);
  add(view, candidate("第一段\n第二行"));
  assert.equal(view.draftQuotes.length, 2, "the same range must not duplicate");
  add(view, candidate("第一段\n第二行", "message-1", 100));
  add(view, candidate("第一段\n第二行", "message-3"));
  assert.equal(view.draftQuotes.length, 4, "identical text at different locations must be kept");
  const removed = view.draftQuotes[1];
  view.removeDraftQuote(removed.id);
  assert.equal(view.draftQuotes.length, 3);
  assert.ok(!view.buildQuotedRequest("问题").includes("另一个片段"));
  assert.ok(view.buildQuotedRequest("问题").includes("> 第一段\n> 第二行"));
  assert.ok(view.buildQuotedRequest("").endsWith("请针对以上引用内容进行分析。"));
  view.clearDraftQuotes();
  assert.equal(view.quoteStripEl.hidden, true);
  assert.equal(view.buildQuotedRequest("普通问题"), "普通问题");
  assert.equal(view.contentEl.ownerDocument.defaultView.CSS.highlights.size, 0);
  assert.equal(view.inputEl.value, "请对比这几处内容");

  const fallback = createView();
  fallback.contentEl.ownerDocument.defaultView = {};
  add(fallback, candidate("<script>这是纯文本</script>"));
  assert.equal(fallback.draftQuotes.length, 1, "highlights are optional");
  assert.ok(fallback.buildQuotedRequest("").includes("> <script>这是纯文本</script>"));

  const shared = createView();
  shared.contentEl.ownerDocument = view.contentEl.ownerDocument;
  add(view, candidate("窗口一"));
  add(shared, candidate("窗口二"));
  view.clearDraftQuotes();
  assert.equal(shared.contentEl.ownerDocument.defaultView.CSS.highlights.get("codex-chat-quotes").size, 1);

  for (const failure of ["provider", "images", "references", "importing"]) {
    const failed = createView();
    add(failed, candidate("不要丢失"));
    if (failure === "provider") failed.plugin.getProvider = () => ({ available: false });
    if (failure === "images") failed.plugin.resolveImageAttachmentPaths = () => { throw new Error("missing image"); };
    if (failure === "references") failed.plugin.getReferencedNotes = async () => { throw new Error("note lookup failed"); };
    if (failure === "importing") failed.isImportingAttachments = true;
    await failed.send();
    assert.equal(failed.draftQuotes.length, 1, failure);
    assert.equal(failed.messages.length, 0, failure);
    assert.equal(failed.isRunning(), false, failure);
    assert.equal(failed.quoteStripEl.inert, false, failure);
  }

  const sent = createView();
  add(sent, candidate("只发送引用"));
  let releaseNotes;
  sent.plugin.getReferencedNotes = () => new Promise((resolve) => { releaseNotes = resolve; });
  const sending = sent.send();
  assert.equal(sent.isRunning(), true);
  add(sent, candidate("不能在发送中追加"));
  assert.equal(sent.draftQuotes.length, 1);
  await sent.send();
  releaseNotes([]);
  await sending;
  assert.equal(sent.messages.length, 1, "double send must not create a second turn");
  assert.equal(sent.draftQuotes.length, 0);
  assert.equal(sent.messages[0].content, sent.sentPrompt);
  assert.ok(sent.sentPrompt.includes("> 只发送引用"));
  assert.equal(sent.inputEl.value, "");

  for (const action of ["stop", "onClose"]) {
    const cancelled = createView();
    add(cancelled, candidate("等待笔记读取"));
    let finishLookup;
    cancelled.plugin.getReferencedNotes = () => new Promise((resolve) => { finishLookup = resolve; });
    const pending = cancelled.send();
    await cancelled[action]();
    finishLookup([]);
    await pending;
    assert.equal(cancelled.messages.length, 0, action);
    assert.equal(cancelled.sentPrompt, undefined, action);
    assert.equal(cancelled.draftQuotes.length, action === "stop" ? 1 : 0, action);
  }

  for (const action of ["switchProvider", "newConversation", "resumeConversation", "switchToConversationBranch", "onClose"]) {
    const changed = createView();
    add(changed, candidate("旧会话片段"));
    if (action === "switchProvider") await changed.switchProvider("claude");
    else if (action === "resumeConversation") await changed.resumeConversation("other-conversation");
    else if (action === "switchToConversationBranch") await changed.switchToConversationBranch({ id: "message-1" }, "through");
    else await changed[action]();
    assert.equal(changed.draftQuotes.length, 0, action);
    assert.equal(changed.contentEl.ownerDocument.defaultView.CSS.highlights.size, 0, action);
  }
  console.log("codex-chat multi-quote tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
