# Security policy

## Supported versions

Security fixes are provided for the latest published version of AI Workspace.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub Security Advisories](https://github.com/liuwenyang/obsidian-ai-workspace/security/advisories/new). Do not include credentials, private Vault content, or provider session data in a public issue.

Include the affected version, operating system, Obsidian version, provider, reproduction steps, and the minimum sanitized logs needed to understand the issue. You can expect an acknowledgement within seven days.

## Security boundary

AI Workspace starts locally installed provider CLIs and can grant them read or write access to a Vault. A report is especially useful when it concerns approval bypasses, unsafe path handling, unintended access outside the Vault, credential exposure, prompt injection that crosses a documented trust boundary, or release-artifact integrity.
