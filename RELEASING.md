# Releasing AI Workspace

This repository publishes a desktop-only Obsidian community plugin. Every public release must remain reproducible, reviewable, and free of device-local data.

## Public-release gates

Before creating a tag:

1. Confirm `manifest.json`, `package.json`, and `versions.json` use the same semantic version.
2. Run `npm ci`, `npm test`, `npm run lint`, and `npm run release:check`.
3. Confirm `data.json`, Vault conversation records, attachments, credentials, and local executable paths are not tracked.
4. Review the README disclosures for subprocess execution, network use, filesystem access, and local storage.
5. Install the three release assets in a clean Vault and complete a desktop smoke test.

## Creating a release

1. Merge the validated change into the default branch.
2. Create a tag that exactly matches `manifest.json.version`, without a leading `v`.
3. Push the tag. GitHub Actions reruns the gates, attests the release assets, and creates a draft release.
4. Review the generated release and publish it.

Obsidian downloads these individual assets from the matching GitHub release:

- `main.js`
- `manifest.json`
- `styles.css`

## Community review

The initial version is submitted through the Obsidian Community developer dashboard. Later GitHub releases are reviewed automatically. If a release fails review, keep the previous passing version available, fix the findings, increment the version, and publish a new release rather than replacing an existing tag.
