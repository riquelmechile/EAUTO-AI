import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const templateMode = process.argv.includes("--template");
const envArgument = process.argv.find((argument) => argument.startsWith("--env="));
const envPath = resolve(process.cwd(), envArgument?.slice(6) ?? ".env.production");
const manifestPath = resolve(process.cwd(), "config/credential-requirements.json");

if (!existsSync(envPath)) throw new Error(`Credential environment file not found: ${envPath}.`);
const environment = parseEnvironment(await readFile(envPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validateManifest(manifest);

const failures = [];
const pending = [];
const ready = [];
const discovery = [];

for (const group of manifest.groups) {
  console.log(`\n[${group.id}] ${group.description}`);
  for (const requirement of group.variables) {
    const value = environment[requirement.name]?.trim();
    if (!value || isPlaceholder(value)) {
      pending.push(requirement.name);
      console.log(`○ ${requirement.name} pending (${requirement.source})`);
      continue;
    }
    const result = validateValue(requirement.validator, value, environment);
    if (!result.ok) {
      failures.push(`${requirement.name}: ${result.reason}`);
      console.log(`✗ ${requirement.name} invalid`);
    } else if (result.discovery) {
      discovery.push(requirement.name);
      console.log(`◇ ${requirement.name} awaits live discovery`);
    } else {
      ready.push(requirement.name);
      console.log(`✓ ${requirement.name} configured`);
    }
  }
}

validateCrossFieldInvariants(environment, failures);

console.log("\nCredential readiness summary");
console.log(`✓ configured: ${ready.length}`);
console.log(`◇ live discovery: ${discovery.length}`);
console.log(`○ pending: ${pending.length}`);
console.log(`✗ invalid: ${failures.length}`);
if (pending.length > 0) console.log(`Pending names: ${pending.join(", ")}`);
for (const failure of failures) console.error(`✗ ${failure}`);

if (failures.length > 0 || (!templateMode && pending.length > 0)) process.exitCode = 1;
else console.log(templateMode ? "CREDENTIAL_TEMPLATE_OK" : "CREDENTIALS_READY");

function validateManifest(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.schemaVersion !== "eauto-credential-requirements-v1" ||
    !Array.isArray(value.groups)
  ) {
    throw new Error("Invalid credential requirements manifest.");
  }
  const names = new Set();
  for (const group of value.groups) {
    if (!group || typeof group.id !== "string" || !Array.isArray(group.variables)) {
      throw new Error("Every credential group requires an id and variables array.");
    }
    for (const requirement of group.variables) {
      if (
        !requirement ||
        typeof requirement.name !== "string" ||
        typeof requirement.source !== "string" ||
        typeof requirement.validator !== "string"
      ) {
        throw new Error(`Invalid credential requirement in group ${group.id}.`);
      }
      if (names.has(requirement.name)) throw new Error(`Duplicate credential ${requirement.name}.`);
      names.add(requirement.name);
    }
  }
}

function validateValue(validator, value, all) {
  switch (validator) {
    case "non-placeholder":
      return ok();
    case "strong-secret":
      return value.length >= 24 ? ok() : fail("must contain at least 24 characters");
    case "hostname":
      return /^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/i.test(value)
        ? ok()
        : fail("must be a valid hostname");
    case "https-url":
      return validateHttpsUrl(value);
    case "uuid":
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
        ? ok()
        : fail("must be a UUID");
    case "immutable-image":
      return /^ghcr\.io\/riquelmechile\/eauto-ai@sha256:[a-f0-9]{64}$/.test(value)
        ? ok()
        : fail("must reference the immutable EAUTO-AI GHCR digest");
    case "postgres-url":
      return validatePostgresUrl(value, all);
    case "operator-identities":
      return validateOperators(value);
    case "base64-32":
      return Buffer.from(value, "base64").byteLength === 32
        ? ok()
        : fail("must decode to exactly 32 bytes");
    case "numeric-id":
      return /^\d+$/.test(value) ? ok() : fail("must contain only digits");
    case "https-route-map":
      return validateRouteMap(value);
    case "advertiser-map":
      return validateAdvertiserMap(value);
    default:
      return fail(`uses unknown validator ${validator}`);
  }
}

function validateHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return fail("must use HTTPS");
    if (url.username || url.password || url.hash) {
      return fail("cannot embed credentials or a fragment");
    }
    return ok();
  } catch {
    return fail("must be a valid HTTPS URL");
  }
}

function validatePostgresUrl(value, all) {
  try {
    const url = new URL(value);
    if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
      return fail("must use postgres:// or postgresql://");
    }
    if (!url.username || !url.password || !url.hostname || url.pathname.length < 2) {
      return fail("requires username, password, host and database");
    }
    if (all.POSTGRES_PASSWORD && decodeURIComponent(url.password) !== all.POSTGRES_PASSWORD) {
      return fail("password does not match POSTGRES_PASSWORD");
    }
    return ok();
  } catch {
    return fail("must be a valid PostgreSQL URL with percent-encoded credentials");
  }
}

function validateOperators(value) {
  try {
    const operators = JSON.parse(value);
    if (!Array.isArray(operators) || operators.length === 0) {
      return fail("must contain at least one operator identity");
    }
    const ids = new Set();
    for (const operator of operators) {
      if (!operator || typeof operator !== "object" || Array.isArray(operator)) {
        return fail("contains a non-object identity");
      }
      if (typeof operator.id !== "string" || !operator.id.trim() || ids.has(operator.id)) {
        return fail("operator ids must be unique non-empty strings");
      }
      ids.add(operator.id);
      if (!/^[a-f0-9]{64}$/.test(String(operator.tokenHash))) {
        return fail("every tokenHash must be a SHA-256 hex digest");
      }
      if (typeof operator.organizationId !== "string" || !operator.organizationId.trim()) {
        return fail("every operator requires organizationId");
      }
      if (!Array.isArray(operator.roles) || operator.roles.length === 0) {
        return fail("every operator requires at least one role");
      }
      if (!Array.isArray(operator.accountIds) || operator.accountIds.length === 0) {
        return fail("every operator requires account scope");
      }
    }
    return ok();
  } catch {
    return fail("must be valid JSON");
  }
}

function validateRouteMap(value) {
  try {
    const routes = JSON.parse(value);
    if (!routes || typeof routes !== "object" || Array.isArray(routes)) {
      return fail("must contain a JSON object");
    }
    if (Object.keys(routes).length === 0) return fail("cannot be empty");
    for (const [sourceId, endpoint] of Object.entries(routes)) {
      if (!sourceId.trim() || typeof endpoint !== "string") {
        return fail("must map non-empty source IDs to URLs");
      }
      const validated = validateHttpsUrl(endpoint);
      if (!validated.ok) return fail(`route ${sourceId} ${validated.reason}`);
    }
    return ok();
  } catch {
    return fail("must be valid JSON");
  }
}

function validateAdvertiserMap(value) {
  try {
    const mappings = JSON.parse(value);
    if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
      return fail("must contain a JSON object");
    }
    const entries = Object.entries(mappings);
    if (entries.length === 0) return { ok: true, discovery: true };
    for (const [accountId, advertiserId] of entries) {
      if (!accountId.trim() || typeof advertiserId !== "string" || !/^\d+$/.test(advertiserId)) {
        return fail("must map account IDs to numeric advertiser IDs");
      }
    }
    return ok();
  } catch {
    return fail("must be valid JSON");
  }
}

function validateCrossFieldInvariants(values, errors) {
  if (
    configuredValue(values, "API_DOMAIN") &&
    configuredValue(values, "S3_DOMAIN") &&
    values.API_DOMAIN === values.S3_DOMAIN
  ) {
    errors.push("API_DOMAIN and S3_DOMAIN must be different hosts");
  }
  if (
    configuredValue(values, "MINIO_ROOT_USER") &&
    configuredValue(values, "OBJECT_STORAGE_ACCESS_KEY") &&
    values.MINIO_ROOT_USER !== values.OBJECT_STORAGE_ACCESS_KEY
  ) {
    errors.push("OBJECT_STORAGE_ACCESS_KEY must match MINIO_ROOT_USER");
  }
  if (
    configuredValue(values, "MINIO_ROOT_PASSWORD") &&
    configuredValue(values, "OBJECT_STORAGE_SECRET_KEY") &&
    values.MINIO_ROOT_PASSWORD !== values.OBJECT_STORAGE_SECRET_KEY
  ) {
    errors.push("OBJECT_STORAGE_SECRET_KEY must match MINIO_ROOT_PASSWORD");
  }
  if (
    configuredValue(values, "MELI_PLASTICOV_SELLER_ID") &&
    configuredValue(values, "MELI_MAUSTIAN_SELLER_ID") &&
    values.MELI_PLASTICOV_SELLER_ID === values.MELI_MAUSTIAN_SELLER_ID
  ) {
    errors.push("Plasticov and Maustian seller IDs must be different");
  }
  if (
    values.MELI_PRODUCT_ADS_ENABLED === "true" &&
    values.MELI_PRODUCT_ADS_ACCOUNT_ID !== "plasticov"
  ) {
    errors.push("Product Ads first rollout must use MELI_PRODUCT_ADS_ACCOUNT_ID=plasticov");
  }
  if (values.MELI_QUESTION_ANSWER_ENABLED === "true") {
    if (values.MELI_QUESTION_ANSWER_ACCOUNT_ID !== "plasticov") {
      errors.push("question.answer first rollout must use Plasticov");
    }
    if (!values.MELI_QUESTION_ANSWER_POLICY_VERSION?.trim()) {
      errors.push("question.answer requires a server-owned policy version");
    }
  }
}

function configuredValue(values, key) {
  const value = values[key]?.trim();
  return Boolean(value && !isPlaceholder(value));
}

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized.includes("__required__") ||
    normalized.includes("replace-me") ||
    normalized.includes("example.cl") ||
    normalized.includes("example.com") ||
    normalized.endsWith("sha256:")
  );
}

function parseEnvironment(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    result[trimmed.slice(0, separator).trim()] = unquote(trimmed.slice(separator + 1).trim());
  }
  return result;
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

function ok() {
  return { ok: true, discovery: false };
}

function fail(reason) {
  return { ok: false, discovery: false, reason };
}
