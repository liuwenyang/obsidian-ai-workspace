import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const requiredAssets = ["main.js", "manifest.json", "styles.css"];
const forbiddenTrackedNames = new Set([
  "data.json",
  ".env",
  ".env.local",
  "credentials.json",
  "secrets.json",
]);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function fail(message) {
  throw new Error(`Release validation failed: ${message}`);
}

const [manifest, packageJson, versions, readme] = await Promise.all([
  readJson("manifest.json"),
  readJson("package.json"),
  readJson("versions.json"),
  readFile("README.md", "utf8"),
]);

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  fail("manifest version must use x.y.z semantic versioning");
}
if (packageJson.version !== manifest.version) {
  fail("package.json and manifest.json versions differ");
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  fail("versions.json does not map the release to manifest.minAppVersion");
}
if (!/^[a-z][a-z-]*[a-z]$/.test(manifest.id) || manifest.id.includes("obsidian") || manifest.id.endsWith("plugin")) {
  fail("manifest id does not meet Obsidian Community requirements");
}
if (!/^[A-Za-z0-9 +()-]+$/.test(manifest.name) || manifest.name.includes("Obsidian") || manifest.name.includes("Plugin")) {
  fail("manifest name contains a disallowed word or punctuation mark");
}
if (typeof manifest.author !== "string" || !manifest.author.trim() || manifest.author === "Local") {
  fail("manifest author must identify the public maintainer");
}
if (typeof manifest.description !== "string" || manifest.description.length > 250 || !manifest.description.endsWith(".")) {
  fail("manifest description must be at most 250 characters and end with a period");
}
if (manifest.isDesktopOnly !== true) {
  fail("this Node.js subprocess plugin must remain desktop-only");
}

const requestedTag = process.argv[2] || process.env.GITHUB_REF_NAME || "";
if (requestedTag && requestedTag !== manifest.version) {
  fail(`tag ${requestedTag} does not match manifest version ${manifest.version}`);
}

await Promise.all(requiredAssets.map((asset) => access(asset)));

for (const disclosure of ["Data sent to providers", "Local processes and filesystem access", "Telemetry and updates"]) {
  if (!readme.includes(disclosure)) fail(`README is missing the ${disclosure} disclosure`);
}

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
for (const trackedFile of trackedFiles) {
  const normalized = trackedFile.replaceAll("\\", "/");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (forbiddenTrackedNames.has(fileName) || normalized.startsWith("AI Workspace/Conversations/")) {
    fail(`forbidden local file is tracked: ${trackedFile}`);
  }
}

console.log(`Release metadata validated for ${manifest.version}.`);
