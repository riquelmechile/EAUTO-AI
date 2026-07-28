import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const templateMode = process.argv.includes("--template");
const envArgument = process.argv.find((argument) => argument.startsWith("--env="));
const envPath = resolve(process.cwd(), envArgument?.slice(6) ?? ".env.production");
const configured = existsSync(envPath) ? parseEnvironment(await readFile(envPath, "utf8")) : {};
const immutableImagePattern = /^ghcr\.io\/riquelmechile\/eauto-ai@sha256:[a-f0-9]{64}$/;

const files = [
  "Dockerfile",
  ".dockerignore",
  ".env.production.example",
  "infra/compose/docker-compose.production.yml",
  "infra/caddy/Caddyfile",
  "infra/minio/Dockerfile",
  "infra/backup/Dockerfile",
  "infra/backup/backup.sh",
  "infra/backup/restore.sh",
  "scripts/init-object-storage.mjs",
  "scripts/migrate.mjs",
  "scripts/smoke-postgres-schema.mjs",
  "scripts/smoke-profit-engine-postgres.mjs",
  "scripts/smoke-supplier-mirror-postgres.mjs",
  "scripts/smoke-supplier-authority-postgres.mjs",
  "scripts/smoke-supplier-sync-invariants-postgres.mjs",
  "scripts/smoke-supplier-cost-feed-postgres.mjs",
  "scripts/smoke-catalog-acquisition-postgres.mjs",
  "scripts/smoke-production-runtime.mjs",
  "scripts/deploy-production.sh",
  "scripts/production-doctor.mjs",
  "infra/postgres/migrations/009a_prepare_agent_work_sessions.sql",
  "infra/postgres/migrations/012_operational_intelligence.sql",
  "infra/postgres/migrations/014_tenant_integrity_and_action_guards.sql",
  "infra/postgres/migrations/015_action_lifecycle_delivery_log.sql",
  "infra/postgres/migrations/016_profit_engine_margin_audit.sql",
  "infra/postgres/migrations/017_supplier_mirror_stock_risk.sql",
  "infra/postgres/migrations/018_supplier_listing_source_uniqueness.sql",
  "infra/postgres/migrations/019_supplier_product_sync_invariants.sql",
  "infra/postgres/migrations/020_supplier_cost_profit_engine_feed.sql",
  "infra/postgres/migrations/021_supplier_authority_and_freshness_guards.sql",
  "infra/postgres/migrations/022_supplier_authoritative_audit_scheduling.sql",
  "infra/postgres/migrations/023_supplier_authority_transfer_scheduling.sql",
  "infra/postgres/migrations/024_supplier_cost_evidence_stability.sql",
  "infra/postgres/migrations/025_profitability_supplier_stock_wakeup.sql",
  "infra/postgres/migrations/026_supplier_failed_upsert_invariants.sql",
  "infra/postgres/migrations/027_catalog_acquisition_candidates.sql",
  "packages/content/src/httpContentProvider.ts",
  "packages/infrastructure/src/httpActionExecutor.ts",
  "packages/infrastructure/src/httpCatalogAcquisitionProviders.ts",
  "apps/mobile/app.config.cjs",
  "apps/mobile/eas.json",
  ".github/workflows/release.yml",
  "docs/runbooks/production-release.md",
];
const secrets = [
  "POSTGRES_PASSWORD",
  "MINIO_ROOT_USER",
  "MINIO_ROOT_PASSWORD",
  "OBJECT_STORAGE_ACCESS_KEY",
  "OBJECT_STORAGE_SECRET_KEY",
  "OPERATOR_TOKENS_JSON",
  "CONTENT_PROVIDER_API_KEY",
  "CATALOG_VISUAL_PROVIDER_API_KEY",
  "CATALOG_SUPPLIER_API_KEY",
  "ACTION_PROVIDER_API_KEY",
  "LLM_API_KEY",
  "MELI_CLIENT_ID",
  "MELI_CLIENT_SECRET",
  "MELI_TOKEN_VAULT_KEY_BASE64",
  "MELI_PLASTICOV_SELLER_ID",
  "MELI_MAUSTIAN_SELLER_ID",
  "MELI_APPLICATION_ID",
  "MELI_WEBHOOK_TOKEN",
  "RESTIC_REPOSITORY",
  "RESTIC_PASSWORD",
  "RESTIC_AWS_ACCESS_KEY_ID",
  "RESTIC_AWS_SECRET_ACCESS_KEY",
  "EAS_PROJECT_ID",
];
const requiredRuntimeValues = ["EAUTO_IMAGE", "DATABASE_URL"];
const failures = [];
const pending = [];

for (const path of files) {
  const ok = existsSync(resolve(process.cwd(), path));
  console.log(`${ok ? "✓" : "✗"} ${path}`);
  if (!ok) failures.push(`Missing file: ${path}`);
}
for (const key of [...secrets, ...requiredRuntimeValues]) {
  const value = configured[key]?.trim();
  const ready = Boolean(value && !isPlaceholder(value));
  console.log(`${ready ? "✓" : "○"} ${key}${ready ? " configured" : " pending"}`);
  if (!ready) pending.push(key);
}
const image = configured.EAUTO_IMAGE?.trim();
if (image && !isPlaceholder(image) && !immutableImagePattern.test(image)) {
  failures.push("EAUTO_IMAGE must use the immutable GHCR digest form ghcr.io/riquelmechile/eauto-ai@sha256:<64 hex>.");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else if (!templateMode && pending.length > 0) {
  for (const key of pending) console.error(`- Missing production value: ${key}`);
  process.exitCode = 1;
} else {
  console.log(
    templateMode
      ? `Production template verified with ${pending.length} deployment values pending.`
      : "Production configuration verified.",
  );
}

function parseEnvironment(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    result[trimmed.slice(0, separator).trim()] = result[trimmed.slice(0, separator).trim()] ??
      trimmed.slice(separator + 1).trim();
  }
  return result;
}

function isPlaceholder(value) {
  return value.includes("__REQUIRED__") || value.includes("example.cl");
}
