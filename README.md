# AI Workspace for Codex & Claude

AI Workspace is a desktop-only Obsidian plugin that provides a native conversation interface for locally authenticated Codex, Claude Code, and ReClaude CLIs.

## Features

- Codex `app-server` streaming with safe `codex exec` fallback
- Claude Code and ReClaude CLI adapters
- Image selection, paste, drag-and-drop, history, and Vault-relative attachments
- Editable prompts implemented as traceable conversation branches
- Native or compatible conversation forking and thread recovery
- Per-turn model switching without creating a new conversation
- Rich reasoning, plan, command, tool, file-change, approval, and diff timeline cards
- Cross-device conversation sync through Vault Markdown records
- Read-only and workspace-write permission modes

## Privacy boundary

The repository deliberately excludes `data.json`. That file contains device-local settings, executable paths, private conversation cache, active selections, and Provider runtime identifiers.

Cross-device conversation records are stored separately in the Vault at `AI Workspace/Conversations/`. They belong to the user's Vault sync workflow and are not part of this source repository.

The plugin does not store API keys. It calls CLI tools that are already authenticated on the local machine.

## Per-turn model switching

The model selector belongs to the next turn, not to the whole conversation:

- A model can be changed after the current response finishes; Provider and model selectors stay locked while a turn is running.
- The selected model is captured when sending and is written to every user, assistant, and timeline message created by that turn.
- Existing Codex, Claude Code, and ReClaude sessions are resumed with the newly selected model because their current CLI/protocol versions accept a model override on resume/turn start.
- A Provider adapter that cannot safely change models in an existing thread must declare that capability. The plugin then detaches the runtime thread and starts a compatible thread with the visible conversation history injected, preserving the local conversation.
- Older conversations without runtime-model metadata keep their current thread until the user actually changes the model.

## Install from this private repository

Clone the repository into the Vault's community-plugin directory using the manifest ID as the folder name:

```powershell
git clone https://github.com/liuwenyang/obsidian-ai-workspace.git .obsidian/plugins/codex-chat
```

Restart Obsidian, then enable **AI Workspace for Codex & Claude** under Community plugins.

The plugin requires desktop Obsidian and at least one locally available Provider:

- Codex CLI
- Claude Code
- ReClaude

## Development

No npm dependencies are required for the current JavaScript build and test suite.

```powershell
npm test
```

`main.js` is the self-contained runtime entry loaded by Obsidian. The smaller domain modules remain independently testable and must not be reintroduced as runtime-relative CommonJS dependencies without adding a bundling step.

## Repository layout

```text
main.js                         Obsidian runtime entry
styles.css                      Plugin UI styles
manifest.json                   Obsidian plugin metadata
codex-app-server-client.js      JSON-RPC process/protocol domain
conversation-utils.js           Conversation and branching domain
attachment-utils.js             Image attachment domain
conversation-sync-utils.js      Cross-device synchronization domain
test/                           Dependency-free regression tests
```
