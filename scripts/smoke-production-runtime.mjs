import { readFile } from "node:fs/promises";
import { loadConfig } from "../apps/api/dist/config.js";
import { createRuntime } from "../apps/api/dist/runtime.js";

const template = parseEnvironment(await readFile(new URL("../.env.production.example", import.meta.url), "utf8"));
const config = loadConfig({
  ...template,
  POSTGRES_PASSWORD: "postgres-smoke-password",
  REDIS_PASSWORD: "redis-smoke-password",
  DATABASE_URL: "postgres://eauto:postgres-smoke-password@postgres:5432/eauto",
  MINIO_ROOT_USER: "minio-smoke-user",
  MINIO_ROOT_PASSWORD: "minio-smoke-password",
  OBJECT_STORAGE_ACCESS_KEY: "minio-smoke-user",
  OBJECT_STORAGE_SECRET_KEY: "minio-smoke-password",
  OPERATOR_TOKENS_JSON: JSON.stringify([
    {
      id: "production-smoke-owner",
      tokenHash: "a".repeat(64),
      organizationId: "maustian",
      roles: ["owner"],
      accountIds: ["plasticov", "maustian"],
    },
  ]),
  CONTENT_PROVIDER_API_KEY: "content-smoke-key",
  ACTION_PROVIDER_API_KEY: "action-smoke-key",
  LLM_API_KEY: "llm-smoke-key",
  MELI_CLIENT_ID: "meli-smoke-client",
  MELI_CLIENT_SECRET: "meli-smoke-secret",
  MELI_TOKEN_VAULT_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
  MELI_PLASTICOV_SELLER_ID: "100001",
  MELI_MAUSTIAN_SELLER_ID: "100002",
  MELI_APPLICATION_ID: "100003",
});

const runtime = createRuntime(config);
try {
  assert(runtime.persistenceMode === "postgres", "production runtime must use Postgres");
  assert(runtime.contentGenerationMode === "external", "content provider must be external");
  assert(runtime.actionExecutionMode === "external", "action provider must be external");
  assert(runtime.shadowLlm !== null, "DeepSeek shadow runtime must be enabled");
  assert(runtime.mercadoLibre !== null, "MercadoLibre Chile runtime must be enabled");
  assert(
    runtime.mercadoLibreNotificationIngestion !== null,
    "MercadoLibre webhook ingestion must be enabled",
  );
  assert(
    runtime.mercadoLibreNotificationProcessor !== null,
    "MercadoLibre webhook processor must be enabled",
  );
  console.log("✓ Production configuration parsed");
  console.log("✓ External content provider wired");
  console.log("✓ External action provider wired");
  console.log("✓ DeepSeek and MercadoLibre runtimes wired");
} finally {
  await runtime.close();
}

function parseEnvironment(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    result[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
