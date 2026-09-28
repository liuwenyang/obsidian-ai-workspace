# AI Workspace for Codex and Claude

AI Workspace is a desktop-only Obsidian plugin for working with locally authenticated Codex, Claude Code, and ReClaude CLIs through a native conversation interface.

This is an independent community project. It is not affiliated with or endorsed by Obsidian, OpenAI, or Anthropic.

## Features

- Codex `app-server` streaming with a safe `codex exec` fallback
- Claude Code and ReClaude CLI adapters
- Per-turn model switching without creating a new local conversation
- Image selection, paste, drag-and-drop, and Vault-relative attachments
- Editable prompts implemented as traceable conversation branches
- Native or compatible conversation forking and thread recovery
- Reasoning, plan, command, tool, file-change, approval, and diff timeline cards
- Cross-device conversation sync through Vault Markdown records
- Read-only and workspace-write permission modes

## Requirements

- Obsidian 1.7.2 or later on Windows, macOS, or Linux
- At least one locally installed and authenticated provider CLI:
  - [Codex CLI](https://github.com/openai/codex)
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  - ReClaude

The plugin is desktop-only because it starts local subprocesses through Node.js APIs.

## Installation

### Obsidian Community

After the plugin is accepted, install it from **Settings → Community plugins → Browse**, search for **AI Workspace for Codex and Claude**, and select **Install**.

### GitHub release

1. Download `main.js`, `manifest.json`, and `styles.css` from the matching [GitHub release](https://github.com/liuwenyang/obsidian-ai-workspace/releases).
2. Create `<Vault>/.obsidian/plugins/codex-chat/`.
3. Copy the three files into that folder.
4. Restart Obsidian and enable **AI Workspace for Codex and Claude** under Community plugins.

## Privacy and capabilities

### Data sent to providers

When you start a turn, the selected provider CLI may send your prompt, selected note context, attached images, compatible conversation history, and tool results to its configured remote service. Codex normally connects to OpenAI services; Claude Code normally connects to Anthropic or a user-configured compatible service; ReClaude uses the service configured by that CLI.

The plugin does not operate a proxy server and does not store provider API keys. Provider subprocesses use authentication already configured on the device.

### Local processes and filesystem access

The plugin starts the configured provider executable, which can be outside the Vault, and uses the Vault as its working directory. Provider subprocesses inherit the Obsidian process environment so that local authentication, proxy, certificate, and executable-path settings continue to work. The CLIs may read their own configuration and session files outside the Vault.

Read-only mode requests a read-only provider sandbox. Workspace-write mode allows the provider to modify files in the Vault workspace. Commands and file changes that require approval are shown in the conversation timeline. Provider CLIs are powerful local programs; review approvals and use read-only mode when write access is unnecessary.

### Local storage and sync

- Device-local settings, executable paths, conversation cache, and provider runtime identifiers are stored in the plugin's `data.json` through Obsidian's plugin data API.
- Optional cross-device conversation records are stored as Markdown under `AI Workspace/Conversations/` in the Vault.
- Pasted or selected images are stored using Obsidian's configured attachment location inside the Vault. Conversation records retain Vault-relative attachment metadata rather than Base64 image data.
- Provider CLIs may keep their own sessions and logs outside the Vault according to their configuration.

`data.json`, Vault conversations, attachments, credentials, and device-local paths are excluded from this source repository.

### Telemetry and updates

AI Workspace contains no client-side telemetry, advertising, or self-update mechanism. Network activity is limited to explicit provider work initiated by the user and any provider or MCP services the user configures. Plugin updates are delivered only through Obsidian and matching GitHub releases.

## Per-turn model switching

Model and permission controls sit above the composer. The composer reserves space for Obsidian's status bar as its size changes.

The model selector applies to the next turn instead of the entire conversation. The selected provider and model are captured when a message is sent and stored on the messages created by that turn. Providers that cannot safely switch models in an existing thread start a compatible local thread with the visible conversation history injected.

## Quote multiple excerpts

Select text within a conversation message and use “加入引用” at the upper-right of the selection's last visible line (or Ctrl/Cmd + Shift + Q). The button stays within the message viewport, shifting left near the right edge or below the selection when there is no space above. Repeat on other passages or messages to collect multiple excerpts; no modifier key is required while selecting. Added passages retain a subtle highlight where the browser supports CSS highlights.

The composer displays a compact quote list with source labels, expandable previews, individual removal, and “清空”. Your question remains separate in the input. Sending combines the ordered excerpts and your question as Markdown, so the provider, saved history, and conversation sync receive the same text. Quotes alone can also be sent. Re-adding the same passage from the same message does not duplicate it; identical text from different messages is kept.

Quotes are temporary draft state: switching provider/conversation, editing or forking a message, and closing the view clear the list. Validation failures before sending retain it. Highlights are optional presentation only; stored text snapshots stay intact if streaming or history refresh replaces the source DOM. Selection is confined to one message at a time to avoid collecting message controls or metadata.

## Development

```powershell
npm ci
npm test
npm run lint
npm run release:check
```

`main.js` is the self-contained runtime loaded by Obsidian. The smaller domain modules remain independently testable and must not be reintroduced as runtime-relative CommonJS dependencies without adding a bundling step.

For local quote UI checks, run `node test/quote-ui-preview.js` and open its loopback URL. This fixture loads the real view and stylesheet with a minimal Obsidian host; it never invokes a provider or reads Vault data. Browser artifacts belong in the ignored `output/playwright/` directory.

See [RELEASING.md](RELEASING.md) for the public-release gates and version workflow. Security reports should follow [SECURITY.md](SECURITY.md).

## Repository layout

```text
main.js                         Obsidian runtime entry
styles.css                      Plugin UI styles
manifest.json                   Obsidian plugin metadata
codex-app-server-client.js      JSON-RPC process and protocol domain
conversation-utils.js           Conversation, models, and branching domain
attachment-utils.js             Image attachment domain
conversation-sync-utils.js      Cross-device synchronization domain
test/                           Dependency-free regression tests
```

## License

Licensed under the [MIT License](LICENSE).
