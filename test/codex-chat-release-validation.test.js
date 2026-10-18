const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");
const { version } = require("../manifest.json");

const repositoryRoot = path.resolve(__dirname, "..");
const mismatchedVersion = version === "0.0.0" ? "0.0.1" : "0.0.0";

function validateRelease({ refType, refName, explicitTag, expectedStatus }) {
  const result = spawnSync(process.execPath, [
    "scripts/validate-release.mjs",
    ...(explicitTag ? [explicitTag] : []),
  ], {
    cwd: repositoryRoot,
    env: { ...process.env, GITHUB_REF_TYPE: refType, GITHUB_REF_NAME: refName },
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, expectedStatus, result.stderr || result.stdout);
  if (expectedStatus === 0) {
    assert.ok(result.stdout.includes(`Release metadata validated for ${version}.`));
  } else {
    assert.ok(result.stderr.includes(`tag ${explicitTag || refName} does not match manifest version ${version}`));
  }
}

validateRelease({ refType: "branch", refName: "main", expectedStatus: 0 });
validateRelease({ refType: "branch", refName: "123/merge", expectedStatus: 0 });
validateRelease({ refType: "", refName: "main", expectedStatus: 0 });
validateRelease({ refType: "branch", refName: "main", explicitTag: version, expectedStatus: 0 });
validateRelease({ refType: "branch", refName: "main", explicitTag: mismatchedVersion, expectedStatus: 1 });
validateRelease({ refType: "tag", refName: version, expectedStatus: 0 });
validateRelease({ refType: "tag", refName: mismatchedVersion, expectedStatus: 1 });
validateRelease({ refType: "tag", refName: version, explicitTag: mismatchedVersion, expectedStatus: 1 });

console.log("codex-chat release validation tests passed");
