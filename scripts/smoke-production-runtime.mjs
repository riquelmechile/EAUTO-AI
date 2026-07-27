import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../apps/api/dist/config.js";
import { createRuntime } from "../apps/api/dist/runtime.js";

const compose = ["compose", "-p", "eauto-postgres-smoke", "-f", "infra/compose/docker-compose.yml"];
const databaseUrl = "postgres://eauto:eauto@127.0.0.1:5432/eauto";
let runtime = null;

try {
  run("docker", [...compose, "up", "-d", "postgres"]);
  await waitForPostgres();
  run("node", ["scripts/migrate.mjs"], { DATABASE_URL: databaseUrl });
  run("node", ["scripts/smoke-postgres-schema.mjs"], { DATABASE_URL: databaseUrl });
  run("node", ["scripts/migrate.mjs"], { DATABASE_URL: databaseUrl });

  const template = parseEnvironment(
    await readFile(new URL("../.env.production.example", import.meta.url), "utf8"),
  );
  const config = loadConfig({
    ...template,
    POSTGRES_PASSWORD: "eauto",
    DATABASE_URL: databaseUrl,
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
    MELI_WEBHOOK_TOKEN: "smoke-webhook-token-0123456789abcdef",
  });

  runtime = await createRuntime(config);
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
  console.log("✓ Fresh PostgreSQL migrations applied and idempotent");
  console.log("✓ Scoped repositories and action lifecycle verified");
  console.log("✓ Production configuration parsed");
  console.log("✓ External providers and MercadoLibre runtimes wired");
} finally {
  await runtime?.close();
  run("docker", [...compose, "down", "--volumes", "--remove-orphans"], {}, true);
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync(
      "docker",
      [...compose, "exec", "-T", "postgres", "pg_isready", "-U", "eauto", "-d", "eauto"],
      { encoding: "utf8", stdio: "ignore" },
    );
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("PostgreSQL did not become ready for the production smoke.");
}

function run(command, args, extraEnvironment = {}, allowFailure = false) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    env: { ...process.env, ...extraEnvironment },
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${String(result.status)}.`);
  }
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
