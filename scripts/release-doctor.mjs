import { readFile } from "node:fs/promises";

const [workflow, easSource] = await Promise.all([
  readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
  readFile(new URL("../apps/mobile/eas.json", import.meta.url), "utf8"),
]);
const eas = JSON.parse(easSource);
const failures = [];

requireText(workflow, "eas-version: 21.2.0", "Release workflow must pin EAS CLI 21.2.0.");
requireText(workflow, "id: build", "Container build step must expose its digest output.");
requireText(
  workflow,
  "ghcr.io/riquelmechile/eauto-ai@${{ steps.build.outputs.digest }}",
  "Release workflow must record the immutable runtime digest.",
);
requireText(workflow, "--wait", "Android build and submission must wait for completion.");
requireText(
  workflow,
  '--id "${{ steps.android_build.outputs.build_id }}"',
  "Google Play submission must use the exact completed build ID.",
);
rejectText(workflow, "--no-wait", "Release workflow cannot detach from EAS build completion.");
rejectText(workflow, "eas-version: latest", "Release workflow cannot install a mutable EAS CLI.");
rejectText(workflow, "type=raw,value=latest", "Release workflow cannot publish a latest tag.");
rejectText(workflow, "eas submit --latest", "Submission cannot select an unrelated latest build.");

if (eas.cli?.version !== "21.2.0") failures.push("eas.json must pin cli.version to 21.2.0.");
if (eas.cli?.requireCommit !== true)
  failures.push("eas.json must require a committed source tree.");
for (const profile of ["preview", "production"]) {
  const image = eas.build?.[profile]?.android?.image;
  if (image !== "auto")
    failures.push(`EAS ${profile} Android image must be auto, received ${String(image)}.`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log("✓ Release workflow waits for and identifies signed Android artifacts");
  console.log("✓ EAS CLI and Android image selection are deterministic");
  console.log("✓ Container releases expose an immutable deployment digest");
}

function requireText(content, expected, message) {
  if (!content.includes(expected)) failures.push(message);
}

function rejectText(content, forbidden, message) {
  if (content.includes(forbidden)) failures.push(message);
}
