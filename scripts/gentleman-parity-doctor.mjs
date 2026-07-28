import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const requiredFiles = [
  "docs/sdd/019-gentleman-capability-parity.md",
  "packages/domain/src/agentCollaboration.ts",
  "packages/domain/src/accountBrain.ts",
  "packages/domain/src/specialistDaemons.ts",
  "packages/domain/src/supplyWorkflows.ts",
  "packages/domain/src/productLifecycle.ts",
  "packages/application/src/agentCollaborationService.ts",
  "packages/application/src/accountBrainService.ts",
  "packages/application/src/specialistDaemonScheduler.ts",
  "packages/application/src/supplyWorkflowService.ts",
  "packages/application/src/productLifecycleService.ts",
  "packages/application/src/economicOperationsService.ts",
  "packages/content/src/minimaxContentProvider.ts",
  "packages/infrastructure/src/postgresCompanyIntelligenceRepository.ts",
  "infra/postgres/migrations/032_gentleman_capability_parity.sql",
  "scripts/economic.mjs",
];

for (const file of requiredFiles) {
  assert(existsSync(resolve(process.cwd(), file)), `Missing Gentleman parity file ${file}.`);
}

const domainFiles = [
  "packages/domain/src/agentCollaboration.ts",
  "packages/domain/src/accountBrain.ts",
  "packages/domain/src/specialistDaemons.ts",
  "packages/domain/src/supplyWorkflows.ts",
  "packages/domain/src/productLifecycle.ts",
];
for (const file of domainFiles) {
  const source = await readFile(resolve(process.cwd(), file), "utf8");
  assert(!source.includes("fastify"), `${file} imports Fastify.`);
  assert(!source.includes('from "pg"'), `${file} imports PostgreSQL.`);
  assert(!source.includes("@eauto/infrastructure"), `${file} imports infrastructure.`);
  assert(!source.includes("minimax"), `${file} depends on MiniMax.`);
}

const daemonSource = await readFile(
  resolve(process.cwd(), "packages/domain/src/specialistDaemons.ts"),
  "utf8",
);
const daemonIds = [
  "economic-ingestion",
  "unit-economics",
  "pricing",
  "ads-profitability",
  "analytics",
  "catalog",
  "product-research",
  "listing-retread",
  "supplier-manager",
  "inventory-forecast",
  "acquisition-imports",
  "sales-service",
  "claims-reputation",
  "shipping-logistics",
  "creative-studio",
  "product-ads",
];
for (const id of daemonIds) assert(daemonSource.includes(`"${id}"`), `Missing daemon ${id}.`);
assert(new Set(daemonIds).size === 16, "Daemon catalog must contain exactly sixteen IDs.");

const miniMax = await readFile(
  resolve(process.cwd(), "packages/content/src/minimaxContentProvider.ts"),
  "utf8",
);
assert(miniMax.includes('const MINIMAX_API_ORIGIN = "https://api.minimax.io"'), "MiniMax origin is not fixed.");
assert(miniMax.includes('/v1/image_generation'), "MiniMax image endpoint is missing.");
assert(miniMax.includes('/v1/video_generation'), "MiniMax video endpoint is missing.");
assert(miniMax.includes('/v1/query/video_generation'), "MiniMax video polling endpoint is missing.");
assert(miniMax.includes('/v1/files/retrieve'), "MiniMax file retrieval endpoint is missing.");
assert(miniMax.includes('redirect: "error"'), "MiniMax redirects are not blocked.");

const packageJson = JSON.parse(await readFile(resolve(process.cwd(), "package.json"), "utf8"));
for (const command of [
  "economic:ingest",
  "economic:status",
  "economic:coverage",
  "economic:reconcile",
  "economic:missing",
  "economic:inspect-evidence",
]) {
  assert(typeof packageJson.scripts?.[command] === "string", `Missing npm script ${command}.`);
}

const migration = await readFile(
  resolve(process.cwd(), "infra/postgres/migrations/032_gentleman_capability_parity.sql"),
  "utf8",
);
for (const table of [
  "agent_messages",
  "evidence_requests",
  "evidence_responses",
  "semantic_memory_entries",
  "account_brain_snapshots",
  "specialist_daemon_states",
  "specialist_daemon_runs",
  "supply_workflow_runs",
  "product_lifecycle_assessments",
]) {
  assert(migration.includes(`CREATE TABLE ${table}`), `Migration 032 is missing ${table}.`);
}
assert(migration.includes("search_document tsvector"), "Semantic memory full-text index is missing.");
assert(migration.includes("FOREIGN KEY (organization_id, account_id)"), "Tenant foreign keys are missing.");

const supply = await readFile(
  resolve(process.cwd(), "packages/application/src/supplyWorkflowService.ts"),
  "utf8",
);
assert(supply.includes("Supply workflows are dry-run only"), "Supply workflows are not fail-closed.");
const runtime = await readFile(resolve(process.cwd(), "apps/api/src/runtime.ts"), "utf8");
assert(runtime.includes("MiniMaxContentProvider"), "MiniMax is not wired into the runtime.");
const worker = await readFile(resolve(process.cwd(), "apps/api/src/worker.ts"), "utf8");
assert(worker.includes("companyRuntime.processBatch"), "Company intelligence is not wired into the worker.");

console.log("GENTLEMAN_CAPABILITY_PARITY_OK");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
