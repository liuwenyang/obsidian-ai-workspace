const assert = require("assert");
const {
  cleanConversations,
  cleanHistory,
  createConversation,
  forkConversation,
  previousProviderTurnId,
  providerForkTurnId,
  isCompleteConversationBranch,
  buildCompatibleConversationPrompt,
} = require("../conversation-utils");

const legacy = createConversation("codex", {
  id: "legacy-conversation",
  sessionId: "legacy-thread",
  title: "旧会话",
  messages: [
    { role: "user", content: "第一问" },
    { role: "assistant", content: "第一答" },
  ],
});

assert.strictEqual(legacy.providerThreadId, "legacy-thread");
assert.strictEqual(legacy.sessionId, "legacy-thread");
assert.strictEqual(legacy.providerId, "codex");
assert.ok(legacy.messages.every((message) => typeof message.id === "string" && message.id.length > 0));
assert.ok(legacy.messages.every((message) => message.status === "completed"));
assert.ok(legacy.messages.every((message) => message.kind === "message"));

const cleanedAgain = cleanHistory(legacy.messages, "codex");
assert.deepStrictEqual(
  cleanedAgain.map((message) => message.id),
  legacy.messages.map((message) => message.id),
  "message ids must remain stable after persistence cleaning",
);

const source = createConversation("codex", {
  id: "source-conversation",
  title: "分叉测试",
  providerThreadId: "thread-source",
  messages: [
    { id: "u1", providerTurnId: "turn-1", role: "user", content: "问题一" },
    { id: "a1", providerTurnId: "turn-1", role: "assistant", content: "回答一" },
    { id: "u2", providerTurnId: "turn-2", role: "user", content: "问题二" },
    { id: "a2", providerTurnId: "turn-2", role: "assistant", content: "回答二" },
  ],
});

const before = forkConversation(source, "codex", "u2", "before");
assert.deepStrictEqual(before.messages.map((message) => message.id), ["u1", "a1"]);
assert.strictEqual(before.providerThreadId, null);
assert.strictEqual(before.parentConversationId, source.id);
assert.strictEqual(before.rootConversationId, source.id);
assert.strictEqual(before.forkedFromMessageId, "u2");
assert.strictEqual(before.forkedFromTurnId, "turn-2");
assert.strictEqual(before.branchKind, "pending");
assert.strictEqual(before.branchDepth, 1);

const through = forkConversation(source, "codex", "a1", "through");
assert.deepStrictEqual(through.messages.map((message) => message.id), ["u1", "a1"]);
assert.strictEqual(previousProviderTurnId(source.messages, "u2"), "turn-1");
assert.strictEqual(previousProviderTurnId(source.messages, "u1"), null);
assert.strictEqual(providerForkTurnId(source.messages, "u2", "before"), "turn-1");
assert.strictEqual(providerForkTurnId(source.messages, "u2", "through"), null);
assert.strictEqual(providerForkTurnId(source.messages, "a1", "through"), "turn-1");

const timeline = cleanHistory([
  {
    id: "tool-1",
    providerTurnId: "turn-1",
    providerItemId: "provider-tool-1",
    role: "system",
    kind: "command",
    title: "命令 · git status",
    content: "clean",
    status: "completed",
  },
], "codex")[0];
assert.strictEqual(timeline.kind, "command");
assert.strictEqual(timeline.title, "命令 · git status");
assert.strictEqual(timeline.providerItemId, "provider-tool-1");
assert.strictEqual(isCompleteConversationBranch(through, source), false);
const fullBranch = forkConversation(source, "codex", "a2", "through");
assert.strictEqual(isCompleteConversationBranch(fullBranch, source), true);
const compatiblePrompt = buildCompatibleConversationPrompt(
  [{ id: "history-u", role: "user", content: "旧问题 <tag>" }],
  "新问题",
);
assert.match(compatiblePrompt, /prior_conversation/);
assert.match(compatiblePrompt, /旧问题 &lt;tag&gt;/);
assert.match(compatiblePrompt, /新问题$/);

assert.throws(() => forkConversation(source, "codex", "missing", "before"), /找不到分叉消息/);
assert.throws(() => forkConversation(source, "codex", "u1", "invalid"), /不支持的分叉模式/);

const conversations = cleanConversations([source, { ...source, title: "重复" }], "codex");
assert.strictEqual(conversations.length, 1);

console.log("codex-chat conversation domain tests passed");
