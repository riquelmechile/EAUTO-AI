import { readFile } from "node:fs/promises";

const workflowPaths = [".github/workflows/ci.yml", ".github/workflows/release.yml"];
const allowedActions = new Set([
  "actions/checkout",
  "actions/setup-node",
  "docker/setup-buildx-action",
  "docker/login-action",
  "docker/metadata-action",
  "docker/build-push-action",
  "expo/expo-github-action",
]);
const failures = [];

for (const path of workflowPaths) {
  const content = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const usesPattern = /^\s*-\s+uses:\s+([^@\s]+)@([^\s#]+)/gm;
  for (const match of content.matchAll(usesPattern)) {
    const action = match[1];
    const reference = match[2];
    if (action.startsWith("./")) continue;
    if (!allowedActions.has(action)) failures.push(`${path} uses unapproved action ${action}.`);
    if (!/^[a-f0-9]{40}$/.test(reference)) {
      failures.push(`${path} must pin ${action} to a full 40-character commit SHA.`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log("✓ CI and release actions are pinned to immutable commits");
  console.log("✓ Workflow action allowlist verified");
}
