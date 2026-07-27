import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const templateMode = process.argv.includes("--template");
const envArgument = process.argv.find((argument) => argument.startsWith("--env="));
const envPath = resolve(process.cwd(), envArgument?.slice(6) ?? ".env.production");
const configured = existsSync(envPath) ? parseEnvironment(await readFile(envPath, "utf8")) : {};

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
  "scripts/smoke-production-runtime.mjs",
  "scripts/deploy-production.sh",
  "scripts/production-doctor.mjs",
  "infra/postgres/migrations/009a_prepare_agent_work_sessions.sql",
  "infra/postgres/migrations/012_operational_intelligence.sql",
  "infra/postgres/migrations/014_tenant_integrity_and_action_guards.sql",
  "infra/postgres/migrations/015_action_lifecycle_delivery_log.sql",
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
  const ready = Boolean(value && !isPlaceholder(value));
  console.log(`${ready ? "✓" : "○"} ${key}${ready ? " configured" : " pending"}`);
  if (!ready) pending.push(key);
}

expectValue("NODE_ENV", "production");
expectValue("AUTH_MODE", "static-token");
expectValue("CONTENT_GENERATION_ENABLED", "true");
expectValue("ACTION_EXECUTION_ENABLED", "true");
expectValue("LLM_ENABLED", "true");
expectValue("INTELLIGENCE_WORKER_ENABLED", "true");
expectValue("MELI_ENABLED", "true");
expectValue("MELI_WEBHOOK_ENABLED", "true");
expectHttps("EXPO_PUBLIC_API_URL");
expectHttps("CONTENT_PROVIDER_URL");
expectHttps("MELI_REDIRECT_URI");
expectHttps("OBJECT_STORAGE_PUBLIC_ENDPOINT");
expectHostname("API_DOMAIN");
expectHostname("S3_DOMAIN");
validateImmutableImage();
validateDatabaseUrl();
validateActionRoutes();

if (
  configured.API_DOMAIN &&
  configured.S3_DOMAIN &&
  !isPlaceholder(configured.API_DOMAIN) &&
  configured.API_DOMAIN === configured.S3_DOMAIN
) {
  failures.push("API_DOMAIN and S3_DOMAIN must be separate hosts.");
}
if (configured.OPERATOR_TOKENS_JSON && !isPlaceholder(configured.OPERATOR_TOKENS_JSON)) {
  try {
    const operators = JSON.parse(configured.OPERATOR_TOKENS_JSON);
    if (!Array.isArray(operators) || operators.length === 0) {
      failures.push("OPERATOR_TOKENS_JSON requires at least one operator.");
    }
  } catch {
    failures.push("OPERATOR_TOKENS_JSON must be valid JSON.");
  }
}
if (
  configured.MELI_WEBHOOK_TOKEN &&
  !isPlaceholder(configured.MELI_WEBHOOK_TOKEN) &&
  configured.MELI_WEBHOOK_TOKEN.length < 32
) {
  failures.push("MELI_WEBHOOK_TOKEN must contain at least 32 characters.");
}
if (
  configured.MELI_TOKEN_VAULT_KEY_BASE64 &&
  !isPlaceholder(configured.MELI_TOKEN_VAULT_KEY_BASE64) &&
  Buffer.from(configured.MELI_TOKEN_VAULT_KEY_BASE64, "base64").byteLength !== 32
) {
  failures.push("MELI_TOKEN_VAULT_KEY_BASE64 must decode to 32 bytes.");
}
if (
  configured.OBJECT_STORAGE_ACCESS_KEY &&
  configured.MINIO_ROOT_USER &&
  !isPlaceholder(configured.OBJECT_STORAGE_ACCESS_KEY) &&
  configured.OBJECT_STORAGE_ACCESS_KEY !== configured.MINIO_ROOT_USER
) {
  failures.push("Self-hosted MinIO requires OBJECT_STORAGE_ACCESS_KEY to match MINIO_ROOT_USER.");
}
if (
  configured.OBJECT_STORAGE_SECRET_KEY &&
  configured.MINIO_ROOT_PASSWORD &&
  !isPlaceholder(configured.OBJECT_STORAGE_SECRET_KEY) &&
  configured.OBJECT_STORAGE_SECRET_KEY !== configured.MINIO_ROOT_PASSWORD
) {
  failures.push(
    "Self-hosted MinIO requires OBJECT_STORAGE_SECRET_KEY to match MINIO_ROOT_PASSWORD.",
  );
}

console.log(`\nImplementation failures: ${failures.length}`);
console.log(`Configuration values pending: ${pending.length}`);
for (const failure of failures) console.error(`✗ ${failure}`);
if (pending.length > 0) console.log(`Pending: ${pending.join(", ")}`);
if (failures.length > 0 || (!templateMode && pending.length > 0)) process.exitCode = 1;

function expectValue(key, expected) {
  if (configured[key] !== expected) failures.push(`${key} must be ${expected}.`);
}

function expectHttps(key) {
  const value = configured[key];
  if (!value || (templateMode && isPlaceholder(value))) return;
  try {
    if (new URL(value).protocol !== "https:") failures.push(`${key} must use HTTPS.`);
  } catch {
    failures.push(`${key} must be a valid URL.`);
  }
}

function expectHostname(key) {
  const value = configured[key];
  if (!value || (templateMode && isPlaceholder(value))) return;
  if (!/^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/i.test(value)) {
    failures.push(`${key} must be a valid hostname.`);
  }
}

function validateImmutableImage() {
  const value = configured.EAUTO_IMAGE;
  if (!value || (templateMode && isPlaceholder(value))) return;
  if (!/^ghcr\.io\/riquelmechile\/eauto-ai@sha256:[a-f0-9]{64}$/.test(value)) {
    failures.push(
      "EAUTO_IMAGE must be the immutable GHCR digest ghcr.io/riquelmechile/eauto-ai@sha256:<64 hex>.",
    );
  }
}

function validateDatabaseUrl() {
  const value = configured.DATABASE_URL;
  if (!value || (templateMode && isPlaceholder(value))) return;
  try {
    const url = new URL(value);
    if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
      failures.push("DATABASE_URL must use postgres:// or postgresql://.");
    }
    if (!url.username || !url.password || !url.hostname || url.pathname.length < 2) {
      failures.push("DATABASE_URL requires username, password, host and database name.");
    }
  } catch {
    failures.push(
      "DATABASE_URL must be a valid PostgreSQL URL; percent-encode reserved password characters.",
    );
  }
}

function validateActionRoutes() {
  const value = configured.ACTION_PROVIDER_ROUTES_JSON;
  if (!value || (templateMode && isPlaceholder(value))) return;
  try {
    const routes = JSON.parse(value);
    if (!routes || typeof routes !== "object" || Array.isArray(routes)) {
      failures.push("ACTION_PROVIDER_ROUTES_JSON must be an object.");
      return;
    }
    const entries = Object.entries(routes);
    if (entries.length === 0) failures.push("ACTION_PROVIDER_ROUTES_JSON cannot be empty.");
    for (const [kind, route] of entries) {
      if (!route || typeof route !== "object" || Array.isArray(route)) {
        failures.push(`Action route ${kind} must be an object.`);
        continue;
      }
      for (const field of ["executeUrl", "verifyUrl"]) {
        const url = route[field];
        if (typeof url !== "string") {
          failures.push(`Action route ${kind}.${field} is required.`);
          continue;
        }
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== "https:")
            failures.push(`Action route ${kind}.${field} must use HTTPS.`);
          if (parsed.username || parsed.password) {
            failures.push(`Action route ${kind}.${field} cannot embed credentials.`);
          }
        } catch {
          failures.push(`Action route ${kind}.${field} must be a valid URL.`);
        }
      }
    }
  } catch {
    failures.push("ACTION_PROVIDER_ROUTES_JSON must be valid JSON.");
  }
}

function parseEnvironment(content) {
  const parsed = {};
  for (const line of content.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    const index = value.indexOf("=");
    if (index < 1) continue;
    parsed[value.slice(0, index).trim()] = unquote(value.slice(index + 1).trim());
  }
  return parsed;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isPlaceholder(value) {
  return value.includes("__REQUIRED__") || /<[^>]+>/.test(value);
}
