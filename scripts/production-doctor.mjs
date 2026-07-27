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
  "scripts/deploy-production.sh",
  "scripts/production-doctor.mjs",
  "infra/postgres/migrations/012_operational_intelligence.sql",
  "apps/mobile/app.config.cjs",
  "apps/mobile/eas.json",
  ".github/workflows/release.yml",
  "docs/runbooks/production-release.md",
];
const secrets = [
  "POSTGRES_PASSWORD",
  "REDIS_PASSWORD",
  "MINIO_ROOT_USER",
  "MINIO_ROOT_PASSWORD",
  "OPERATOR_TOKENS_JSON",
  "LLM_API_KEY",
  "MELI_CLIENT_ID",
  "MELI_CLIENT_SECRET",
  "MELI_TOKEN_VAULT_KEY_BASE64",
  "MELI_PLASTICOV_SELLER_ID",
  "MELI_MAUSTIAN_SELLER_ID",
  "MELI_APPLICATION_ID",
  "RESTIC_REPOSITORY",
  "RESTIC_PASSWORD",
  "RESTIC_AWS_ACCESS_KEY_ID",
  "RESTIC_AWS_SECRET_ACCESS_KEY",
  "EAS_PROJECT_ID",
];
const failures = [];
const pending = [];

for (const path of files) {
  const ok = existsSync(resolve(process.cwd(), path));
  console.log(`${ok ? "✓" : "✗"} ${path}`);
  if (!ok) failures.push(`Missing file: ${path}`);
}
for (const key of secrets) {
  const value = configured[key]?.trim();
  const ready = Boolean(value && !isPlaceholder(value));
  console.log(`${ready ? "✓" : "○"} ${key}${ready ? " configured" : " pending"}`);
  if (!ready) pending.push(key);
}

expectValue("NODE_ENV", "production");
expectValue("AUTH_MODE", "tokens");
expectValue("LLM_ENABLED", "true");
expectValue("INTELLIGENCE_WORKER_ENABLED", "true");
expectValue("MELI_ENABLED", "true");
expectValue("MELI_WEBHOOK_ENABLED", "true");
expectHttps("EXPO_PUBLIC_API_URL");
expectHttps("MELI_REDIRECT_URI");
expectHttps("OBJECT_STORAGE_PUBLIC_ENDPOINT");
expectHostname("API_DOMAIN");
expectHostname("S3_DOMAIN");

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
  failures.push("Self-hosted MinIO requires OBJECT_STORAGE_SECRET_KEY to match MINIO_ROOT_PASSWORD.");
}

console.log(`\nImplementation failures: ${failures.length}`);
console.log(`Secrets pending: ${pending.length}`);
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
  return /^<[^>]+>$/.test(value) || value === "__REQUIRED__";
}
