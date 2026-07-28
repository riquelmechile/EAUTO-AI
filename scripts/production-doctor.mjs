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
  "scripts/smoke-supplier-sync-invariants-postgres.mjs",
  "scripts/smoke-supplier-cost-feed-postgres.mjs",
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
  "packages/content/src/httpContentProvider.ts",
  "packages/infrastructure/src/httpActionExecutor.ts",
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
  const missing = !value || containsPlaceholder(value);
  if (!missing) continue;
  const message = `${key} is not configured in ${envPath}`;
  console.log(`${templateMode ? "○" : "✗"} ${message}`);
  (templateMode ? pending : failures).push(message);
}

if (!templateMode) {
  const image = configured.EAUTO_IMAGE?.trim() ?? "";
  if (image && !containsPlaceholder(image) && !immutableImagePattern.test(image)) {
    const message = "EAUTO_IMAGE must be an immutable GHCR digest, not a mutable tag.";
    console.log(`✗ ${message}`);
    failures.push(message);
  }
  const databaseUrl = configured.DATABASE_URL?.trim() ?? "";
  if (databaseUrl && !containsPlaceholder(databaseUrl)) {
    try {
      const parsed = new URL(databaseUrl);
      if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
        throw new Error("unsupported scheme");
      }
    } catch {
      const message = "DATABASE_URL must be a valid PostgreSQL URL.";
      console.log(`✗ ${message}`);
      failures.push(message);
    }
  }
}

if (pending.length > 0) {
  console.log(`Template mode: ${pending.length} deployment values remain intentionally external.`);
}
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("EAUTO_PRODUCTION_DOCTOR_OK");
}

function parseEnvironment(source) {
  const result = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim().replace(/^['"]|['"]$/gu, "");
    result[key] = value;
  }
  return result;
}

function containsPlaceholder(value) {
  return /(?:change-me|replace-me|example|your-|<[^>]+>|\$\{[^}]+\})/iu.test(value);
}
