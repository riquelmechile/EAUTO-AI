import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const arguments_ = parseArguments(process.argv.slice(2));
const outputPath = resolve(process.cwd(), arguments_.output);
const operatorTokenPath = `${outputPath}.operator-token`;
const templatePath = resolve(process.cwd(), ".env.production.example");
const template = await readFile(templatePath, "utf8");

const postgresPassword = secret(32);
const minioUser = `eauto-${randomBytes(6).toString("hex")}`;
const minioPassword = secret(32);
const operatorToken = secret(48);
const operatorTokenHash = createHash("sha256").update(operatorToken, "utf8").digest("hex");
const vaultKey = randomBytes(32).toString("base64");
const webhookToken = secret(40);
const resticPassword = secret(32);
const postgresUser = readEnvironmentValue(template, "POSTGRES_USER") ?? "eauto";
const postgresDatabase = readEnvironmentValue(template, "POSTGRES_DB") ?? "eauto";

const generated = Object.freeze({
  POSTGRES_PASSWORD: postgresPassword,
  DATABASE_URL: `postgres://${encodeURIComponent(postgresUser)}:${encodeURIComponent(postgresPassword)}@postgres:5432/${encodeURIComponent(postgresDatabase)}`,
  MINIO_ROOT_USER: minioUser,
  MINIO_ROOT_PASSWORD: minioPassword,
  OBJECT_STORAGE_ACCESS_KEY: minioUser,
  OBJECT_STORAGE_SECRET_KEY: minioPassword,
  OPERATOR_TOKENS_JSON: JSON.stringify([
    {
      id: arguments_.operatorId,
      tokenHash: operatorTokenHash,
      organizationId: arguments_.organizationId,
      roles: ["owner"],
      accountIds: arguments_.accountIds,
    },
  ]),
  MELI_TOKEN_VAULT_KEY_BASE64: vaultKey,
  MELI_WEBHOOK_TOKEN: webhookToken,
  RESTIC_PASSWORD: resticPassword,
});

const rendered = replaceEnvironmentValues(template, generated);
const flag = arguments_.force ? "w" : "wx";
await writeFile(outputPath, rendered, { encoding: "utf8", mode: 0o600, flag });
await chmod(outputPath, 0o600);
await writeFile(operatorTokenPath, `${operatorToken}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag,
});
await chmod(operatorTokenPath, 0o600);

console.log(`✓ generated internal production secrets: ${arguments_.output}`);
console.log(`✓ generated one-time operator enrollment token: ${arguments_.output}.operator-token`);
console.log("✓ both files use mode 0600 and are ignored by .gitignore");
console.log("○ third-party credentials remain as __REQUIRED__ placeholders");
console.log("Next: fill external values, then run npm run credentials:doctor -- --env=<path>.");

function parseArguments(values) {
  const parsed = {
    output: ".env.production.generated",
    organizationId: "maustian",
    operatorId: "sebastian",
    accountIds: ["plasticov", "maustian"],
    force: false,
  };
  for (const value of values) {
    if (value === "--force") parsed.force = true;
    else if (value.startsWith("--output=")) parsed.output = requireText(value.slice(9), "output");
    else if (value.startsWith("--organization=")) {
      parsed.organizationId = requireIdentifier(value.slice(15), "organization");
    } else if (value.startsWith("--operator=")) {
      parsed.operatorId = requireIdentifier(value.slice(11), "operator");
    } else if (value.startsWith("--accounts=")) {
      const accountIds = value
        .slice(11)
        .split(",")
        .map((accountId) => requireIdentifier(accountId.trim(), "account"));
      if (accountIds.length === 0) throw new Error("At least one account is required.");
      parsed.accountIds = [...new Set(accountIds)];
    } else {
      throw new Error(`Unknown argument ${value}.`);
    }
  }
  return parsed;
}

function replaceEnvironmentValues(content, replacements) {
  const pending = new Set(Object.keys(replacements));
  const lines = content.split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    if (separator < 1 || line.trimStart().startsWith("#")) return line;
    const key = line.slice(0, separator).trim();
    if (!(key in replacements)) return line;
    pending.delete(key);
    return `${key}=${replacements[key]}`;
  });
  if (pending.size > 0) {
    throw new Error(`Production template is missing generated variables: ${[...pending].join(", ")}.`);
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function readEnvironmentValue(content, key) {
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith(`${key}=`)) return line.slice(key.length + 1).trim();
  }
  return undefined;
}

function requireIdentifier(value, label) {
  const normalized = requireText(value, label);
  if (!/^[a-z0-9][a-z0-9._-]{1,127}$/i.test(normalized)) {
    throw new Error(`${label} must use letters, numbers, dots, underscores or hyphens.`);
  }
  return normalized;
}

function requireText(value, label) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}

function secret(bytes) {
  return randomBytes(bytes).toString("base64url");
}
