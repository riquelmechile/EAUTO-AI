import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const requireFullParity = process.argv.includes("--require-full-parity");
const manifestPath = resolve(process.cwd(), "config/capability-parity.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const allowedStatuses = new Set(["implemented", "partial", "missing", "superseded"]);
const allowedSources = new Set(["MSL", "kiiess"]);
const failures = [];
const ids = new Set();
const counts = { implemented: 0, partial: 0, missing: 0, superseded: 0 };

if (
  !manifest ||
  typeof manifest !== "object" ||
  manifest.schemaVersion !== "eauto-capability-parity-v1" ||
  manifest.canonicalProject !== "EAUTO-AI" ||
  !Array.isArray(manifest.capabilities)
) {
  throw new Error("Invalid capability parity manifest.");
}

for (const capability of manifest.capabilities) {
  if (!capability || typeof capability !== "object") {
    failures.push("Capability entries must be objects.");
    continue;
  }
  if (typeof capability.id !== "string" || !/^[a-z0-9][a-z0-9-]+$/.test(capability.id)) {
    failures.push("Every capability requires a kebab-case id.");
    continue;
  }
  if (ids.has(capability.id)) failures.push(`Duplicate capability id ${capability.id}.`);
  ids.add(capability.id);
  if (typeof capability.name !== "string" || !capability.name.trim()) {
    failures.push(`${capability.id} requires a name.`);
  }
  if (!allowedStatuses.has(capability.status)) {
    failures.push(`${capability.id} uses unsupported status ${String(capability.status)}.`);
    continue;
  }
  counts[capability.status] += 1;
  if (
    !Array.isArray(capability.sources) ||
    capability.sources.length === 0 ||
    capability.sources.some((source) => !allowedSources.has(source))
  ) {
    failures.push(`${capability.id} must reference MSL and/or kiiess.`);
  }
  const evidence = Array.isArray(capability.evidence) ? capability.evidence : [];
  if (capability.status === "implemented" || capability.status === "partial") {
    if (evidence.length === 0) failures.push(`${capability.id} requires EAUTO-AI evidence paths.`);
    for (const path of evidence) {
      if (typeof path !== "string" || !existsSync(resolve(process.cwd(), path))) {
        failures.push(`${capability.id} evidence is missing: ${String(path)}.`);
      }
    }
  }
  if (capability.status === "superseded") {
    if (!evidence.some((path) => typeof path === "string" && existsSync(resolve(process.cwd(), path)))) {
      failures.push(`${capability.id} requires evidence for the replacement architecture.`);
    }
  }
  if (
    (capability.status === "partial" || capability.status === "missing" || capability.status === "superseded") &&
    (typeof capability.gap !== "string" || !capability.gap.trim())
  ) {
    failures.push(`${capability.id} requires an explicit gap or replacement explanation.`);
  }
  console.log(`${symbol(capability.status)} ${capability.id}: ${capability.status}`);
}

console.log("\nCapability parity summary");
console.log(`✓ implemented: ${counts.implemented}`);
console.log(`△ partial: ${counts.partial}`);
console.log(`○ missing: ${counts.missing}`);
console.log(`↺ superseded: ${counts.superseded}`);
for (const failure of failures) console.error(`✗ ${failure}`);

if (requireFullParity && (counts.partial > 0 || counts.missing > 0)) {
  failures.push(
    `Full parity is not reached: ${counts.partial} partial and ${counts.missing} missing capabilities.`,
  );
}
if (failures.length > 0) process.exitCode = 1;
else console.log("CAPABILITY_PARITY_MANIFEST_OK");

function symbol(status) {
  if (status === "implemented") return "✓";
  if (status === "partial") return "△";
  if (status === "superseded") return "↺";
  return "○";
}
