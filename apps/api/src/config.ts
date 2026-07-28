import { Buffer } from "node:buffer";
import { z } from "zod";
import { ACTION_KINDS, MERCADOLIBRE_ACTION_KINDS } from "@eauto/domain";

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const environmentBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}, z.boolean());

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().default("*"),
  AUTH_MODE: z.enum(["disabled", "static-token"]).default("disabled"),
  AGENT_MANUAL_CONTROL_ENABLED: environmentBoolean.default(false),
  OPERATOR_TOKENS_JSON: z.string().default("[]"),
  SESSION_ACCESS_TTL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(900_000),
  SESSION_REFRESH_TTL_MS: z.coerce
    .number()
    .int()
    .min(3_600_000)
    .max(90 * 86_400_000)
    .default(30 * 86_400_000),
  OBJECT_STORAGE_BUCKET: z.string().min(3).default("eauto-content"),
  OBJECT_STORAGE_REGION: z.string().min(1).default("us-east-1"),
  OBJECT_STORAGE_PUBLIC_ENDPOINT: optionalUrl,
  OBJECT_STORAGE_INTERNAL_ENDPOINT: optionalUrl,
  OBJECT_STORAGE_ACCESS_KEY: optionalString,
  OBJECT_STORAGE_SECRET_KEY: optionalString,
  OBJECT_STORAGE_FORCE_PATH_STYLE: environmentBoolean.default(true),
  SOURCE_IMAGE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1_048_576)
    .max(50_000_000)
    .default(10_000_000),
  SOURCE_IMAGE_UPLOAD_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(300),
  CONTENT_GENERATION_ENABLED: environmentBoolean.default(false),
  CONTENT_PROVIDER_URL: optionalUrl,
  CONTENT_PROVIDER_API_KEY: optionalString,
  CONTENT_PROVIDER_NAME: z.string().min(1).default("external-content-provider"),
  CONTENT_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
  CONTENT_PROVIDER_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(20_000_000)
    .default(2_000_000),
  CONTENT_MAX_ASSET_BYTES: z.coerce
    .number()
    .int()
    .min(1_048_576)
    .max(500_000_000)
    .default(100_000_000),
  CATALOG_ACQUISITION_ENABLED: environmentBoolean.default(false),
  CATALOG_VISUAL_PROVIDER_URL: optionalUrl,
  CATALOG_VISUAL_PROVIDER_API_KEY: optionalString,
  CATALOG_VISUAL_PROVIDER_NAME: z.string().min(1).default("external-visual-search"),
  PRODUCT_FINGERPRINT_PROVIDER_URL: optionalUrl,
  PRODUCT_FINGERPRINT_PROVIDER_API_KEY: optionalString,
  PRODUCT_FINGERPRINT_PROVIDER_NAME: z
    .string()
    .min(1)
    .max(128)
    .default("external-perceptual-fingerprint"),
  PRODUCT_FINGERPRINT_PROVIDER_VERSION: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
    .default("phash-64-v1"),
  PRODUCT_FINGERPRINT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  PRODUCT_FINGERPRINT_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(1_000_000)
    .default(64_000),
  CATALOG_SUPPLIER_ROUTES_JSON: z.string().default("{}"),
  CATALOG_SUPPLIER_API_KEY: optionalString,
  CATALOG_SUPPLIER_PROVIDER_NAME: z.string().min(1).default("external-supplier-catalog"),
  CATALOG_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  CATALOG_PROVIDER_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(20_000_000)
    .default(2_000_000),
  CATALOG_MINIMUM_SIMILARITY_BPS: z.coerce.number().int().min(0).max(10_000).default(8_000),
  CATALOG_MAXIMUM_EVIDENCE_AGE_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(7 * 86_400_000)
    .default(3_600_000),
  CATALOG_POLICY_VERSION: z.string().min(1).max(128).default("catalog-acquisition-v1"),
  ACTION_EXECUTION_ENABLED: environmentBoolean.default(false),
  ACTION_PROVIDER_ROUTES_JSON: z.string().default("{}"),
  ACTION_PROVIDER_API_KEY: optionalString,
  ACTION_PROVIDER_NAME: z.string().min(1).default("external-action-provider"),
  ACTION_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  ACTION_PROVIDER_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(20_000_000)
    .default(2_000_000),
  ACTION_POLICY_VERSION: z.string().min(1).max(128).default("company-policy-v1"),
  ACTION_APPROVAL_TTL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(3_600_000),
  OUTBOX_WORKER_ID: z.string().min(1).default("eauto-outbox"),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  OUTBOX_LEASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),
  OUTBOX_BASE_RETRY_MS: z.coerce.number().int().min(100).max(300_000).default(1_000),
  OUTBOX_MAX_RETRY_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(300_000),
  INTELLIGENCE_WORKER_ENABLED: environmentBoolean.default(false),
  INTELLIGENCE_WORKER_ID: z.string().min(1).default("eauto-intelligence"),
  INTELLIGENCE_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  INTELLIGENCE_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  INTELLIGENCE_LEASE_MS: z.coerce.number().int().min(5_000).max(300_000).default(60_000),
  INTELLIGENCE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  INTELLIGENCE_RETRY_BASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(5_000),
  INTELLIGENCE_RETRY_MAX_MS: z.coerce.number().int().min(5_000).max(86_400_000).default(900_000),
  INTELLIGENCE_SESSION_DEADLINE_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .default(900_000),
  INTELLIGENCE_DEFAULT_EVIDENCE_MAX_AGE_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .default(900_000),
  INTELLIGENCE_DEFAULT_BUDGET_MICROS_USD: z.coerce
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .default(50_000),
  INTELLIGENCE_DEFAULT_BUDGET_MINOR_CLP: z.coerce.number().int().min(0).max(100_000_000).default(0),
  LLM_ENABLED: environmentBoolean.default(false),
  LLM_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  LLM_API_KEY: optionalString,
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(90_000),
  LLM_DEFAULT_MAXIMUM_PROMPT_TOKENS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(1_000_000)
    .default(100_000),
  LLM_DEFAULT_MAXIMUM_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(384_000).default(8_000),
  LLM_DAILY_ACCOUNT_BUDGET_MICROS_USD: z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000_000)
    .default(1_000_000),
  MELI_ENABLED: environmentBoolean.default(false),
  MELI_CLIENT_ID: optionalString,
  MELI_CLIENT_SECRET: optionalString,
  MELI_REDIRECT_URI: optionalUrl,
  MELI_AUTHORIZATION_URL: z.string().url().default("https://auth.mercadolibre.cl/authorization"),
  MELI_TOKEN_URL: z.string().url().default("https://api.mercadolibre.com/oauth/token"),
  MELI_API_BASE_URL: z.string().url().default("https://api.mercadolibre.com"),
  MELI_TOKEN_VAULT_KEY_BASE64: optionalString,
  MELI_PLASTICOV_SELLER_ID: optionalString,
  MELI_MAUSTIAN_SELLER_ID: optionalString,
  MELI_OAUTH_STATE_TTL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(600_000),
  MELI_REFRESH_WINDOW_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(300_000),
  MELI_REFRESH_LEASE_MS: z.coerce.number().int().min(5_000).max(300_000).default(30_000),
  MELI_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  MELI_MAXIMUM_SCAN_PAGES: z.coerce.number().int().min(1).max(1_000).default(100),
  MELI_QUESTION_ANSWER_ENABLED: environmentBoolean.default(false),
  MELI_QUESTION_ANSWER_ACCOUNT_ID: optionalString,
  MELI_QUESTION_ANSWER_POLICY_VERSION: z
    .string()
    .min(1)
    .max(128)
    .default("mercadolibre-question-answer-v1"),
  MELI_QUESTION_ANSWER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  MELI_QUESTION_ANSWER_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(2_000_000)
    .default(100_000),
  MELI_WEBHOOK_ENABLED: environmentBoolean.default(false),
  MELI_APPLICATION_ID: optionalString,
  MELI_WEBHOOK_TOKEN: optionalString,
  MELI_NOTIFICATION_WORKER_ID: z.string().min(1).default("eauto-meli-notifications"),
  MELI_NOTIFICATION_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  MELI_NOTIFICATION_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(100),
  MELI_NOTIFICATION_LEASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  MELI_NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),
  MELI_NOTIFICATION_BASE_RETRY_MS: z.coerce.number().int().min(100).max(300_000).default(1_000),
  MELI_NOTIFICATION_MAX_RETRY_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(86_400_000)
    .default(300_000),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(environment);
  if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.message}`);

  let operatorIdentities: unknown;
  try {
    operatorIdentities = JSON.parse(parsed.data.OPERATOR_TOKENS_JSON);
  } catch {
    throw new Error("OPERATOR_TOKENS_JSON must contain valid JSON.");
  }
  if (!Array.isArray(operatorIdentities)) {
    throw new Error("OPERATOR_TOKENS_JSON must contain a JSON array.");
  }

  const hasAccessKey = parsed.data.OBJECT_STORAGE_ACCESS_KEY !== undefined;
  const hasSecretKey = parsed.data.OBJECT_STORAGE_SECRET_KEY !== undefined;
  if (hasAccessKey !== hasSecretKey) {
    throw new Error("Object storage access and secret keys must be configured together.");
  }

  validateContentConfig(parsed.data);
  validateCatalogAcquisitionConfig(parsed.data);
  validateActionExecutionConfig(parsed.data);
  validateLlmConfig(parsed.data);
  validateMercadoLibreConfig(parsed.data);

  if (parsed.data.NODE_ENV === "production") {
    if (!parsed.data.DATABASE_URL) throw new Error("DATABASE_URL is mandatory in production.");
    if (parsed.data.AUTH_MODE !== "static-token") {
      throw new Error("AUTH_MODE=static-token is mandatory in production.");
    }
    if (operatorIdentities.length === 0) {
      throw new Error("At least one operator identity is mandatory in production.");
    }
    if (parsed.data.AGENT_MANUAL_CONTROL_ENABLED) {
      throw new Error("AGENT_MANUAL_CONTROL_ENABLED cannot be enabled in production.");
    }
    const corsOrigins = parsed.data.CORS_ORIGIN.split(",").map((origin) => origin.trim());
    if (corsOrigins.includes("*")) throw new Error("CORS_ORIGIN cannot be wildcard in production.");
    for (const origin of corsOrigins) {
      const url = new URL(origin);
      if (url.protocol !== "https:") throw new Error("CORS_ORIGIN must use HTTPS in production.");
      if (url.pathname !== "/" || url.search || url.hash) {
        throw new Error("CORS_ORIGIN entries must be origins without path, query or fragment.");
      }
    }
    if (!parsed.data.OBJECT_STORAGE_PUBLIC_ENDPOINT) {
      throw new Error("OBJECT_STORAGE_PUBLIC_ENDPOINT is mandatory in production.");
    }
    if (new URL(parsed.data.OBJECT_STORAGE_PUBLIC_ENDPOINT).protocol !== "https:") {
      throw new Error("OBJECT_STORAGE_PUBLIC_ENDPOINT must use HTTPS in production.");
    }
    if (!parsed.data.OBJECT_STORAGE_ACCESS_KEY || !parsed.data.OBJECT_STORAGE_SECRET_KEY) {
      throw new Error("Object storage credentials are mandatory in production.");
    }
  }

  return parsed.data;
}

function validateContentConfig(config: z.infer<typeof configSchema>): void {
  if (!config.CONTENT_GENERATION_ENABLED) return;
  if (!config.CONTENT_PROVIDER_URL || !config.CONTENT_PROVIDER_API_KEY) {
    throw new Error("CONTENT_GENERATION_ENABLED requires CONTENT_PROVIDER_URL and API key.");
  }
  if (
    config.NODE_ENV === "production" &&
    new URL(config.CONTENT_PROVIDER_URL).protocol !== "https:"
  ) {
    throw new Error("CONTENT_PROVIDER_URL must use HTTPS in production.");
  }
}

function validateCatalogAcquisitionConfig(config: z.infer<typeof configSchema>): void {
  let routes: unknown;
  try {
    routes = JSON.parse(config.CATALOG_SUPPLIER_ROUTES_JSON);
  } catch {
    throw new Error("CATALOG_SUPPLIER_ROUTES_JSON must contain valid JSON.");
  }
  if (!isRecord(routes)) {
    throw new Error("CATALOG_SUPPLIER_ROUTES_JSON must contain an object.");
  }
  for (const [sourceId, endpoint] of Object.entries(routes)) {
    if (!sourceId.trim() || typeof endpoint !== "string") {
      throw new Error("Each catalog supplier route must map a source ID to a URL.");
    }
    validateExternalUrl(endpoint, `Catalog supplier route ${sourceId}`, config.NODE_ENV);
  }

  const hasFingerprintUrl = config.PRODUCT_FINGERPRINT_PROVIDER_URL !== undefined;
  const hasFingerprintApiKey = config.PRODUCT_FINGERPRINT_PROVIDER_API_KEY !== undefined;
  if (hasFingerprintUrl !== hasFingerprintApiKey) {
    throw new Error("Product fingerprint provider URL and API key must be configured together.");
  }
  if (config.PRODUCT_FINGERPRINT_PROVIDER_URL) {
    validateExternalUrl(
      config.PRODUCT_FINGERPRINT_PROVIDER_URL,
      "PRODUCT_FINGERPRINT_PROVIDER_URL",
      config.NODE_ENV,
    );
  }

  if (!config.CATALOG_ACQUISITION_ENABLED) return;
  if (
    !config.CATALOG_VISUAL_PROVIDER_URL ||
    !config.CATALOG_VISUAL_PROVIDER_API_KEY ||
    !config.PRODUCT_FINGERPRINT_PROVIDER_URL ||
    !config.PRODUCT_FINGERPRINT_PROVIDER_API_KEY ||
    !config.CATALOG_SUPPLIER_API_KEY
  ) {
    throw new Error(
      "CATALOG_ACQUISITION_ENABLED requires visual URL/key, perceptual fingerprint URL/key and supplier API key.",
    );
  }
  if (Object.keys(routes).length === 0) {
    throw new Error("CATALOG_ACQUISITION_ENABLED requires at least one supplier route.");
  }
  validateExternalUrl(
    config.CATALOG_VISUAL_PROVIDER_URL,
    "CATALOG_VISUAL_PROVIDER_URL",
    config.NODE_ENV,
  );
}

function validateActionExecutionConfig(config: z.infer<typeof configSchema>): void {
  let routes: unknown;
  try {
    routes = JSON.parse(config.ACTION_PROVIDER_ROUTES_JSON);
  } catch {
    throw new Error("ACTION_PROVIDER_ROUTES_JSON must contain valid JSON.");
  }
  if (!isRecord(routes)) throw new Error("ACTION_PROVIDER_ROUTES_JSON must contain an object.");

  const entries = Object.entries(routes);
  const allowedKinds = new Set<string>(ACTION_KINDS);
  const mercadoLibreKinds = new Set<string>(MERCADOLIBRE_ACTION_KINDS);
  for (const [kind, value] of entries) {
    if (!allowedKinds.has(kind)) throw new Error(`Unknown action route kind ${kind}.`);
    if (mercadoLibreKinds.has(kind)) {
      throw new Error(
        `MercadoLibre action route ${kind} is forbidden in the generic action gateway; use a dedicated fail-closed adapter.`,
      );
    }
    if (!isRecord(value)) throw new Error("Each action route must be an object.");
    for (const field of ["executeUrl", "verifyUrl"] as const) {
      const urlValue = value[field];
      if (typeof urlValue !== "string") {
        throw new Error(`Action route ${kind}.${field} is required.`);
      }
      const url = new URL(urlValue);
      if (url.username || url.password) {
        throw new Error(`Action route ${kind}.${field} cannot embed credentials.`);
      }
      if (config.NODE_ENV === "production" && url.protocol !== "https:") {
        throw new Error(`Action route ${kind}.${field} must use HTTPS in production.`);
      }
    }
  }

  if (!config.ACTION_EXECUTION_ENABLED) return;
  if (!config.ACTION_PROVIDER_API_KEY) {
    throw new Error("ACTION_EXECUTION_ENABLED requires ACTION_PROVIDER_API_KEY.");
  }
  if (entries.length === 0) {
    throw new Error("ACTION_EXECUTION_ENABLED requires at least one allowlisted route.");
  }
}

function validateLlmConfig(config: z.infer<typeof configSchema>): void {
  if (!config.LLM_ENABLED) return;
  if (!config.LLM_API_KEY) throw new Error("LLM_ENABLED requires LLM_API_KEY.");
  if (config.NODE_ENV === "production" && new URL(config.LLM_BASE_URL).protocol !== "https:") {
    throw new Error("LLM_BASE_URL must use HTTPS in production.");
  }
}

function validateMercadoLibreConfig(config: z.infer<typeof configSchema>): void {
  if (config.MELI_QUESTION_ANSWER_ENABLED) {
    if (!config.MELI_ENABLED || !config.DATABASE_URL) {
      throw new Error(
        "MELI_QUESTION_ANSWER_ENABLED requires MELI_ENABLED and durable PostgreSQL credentials.",
      );
    }
    if (config.MELI_QUESTION_ANSWER_ACCOUNT_ID !== "plasticov") {
      throw new Error(
        "The first MercadoLibre question.answer rollout is restricted to the Plasticov account.",
      );
    }
  }
  if (config.MELI_WEBHOOK_ENABLED) {
    if (!config.MELI_ENABLED || !config.MELI_APPLICATION_ID || !config.MELI_WEBHOOK_TOKEN) {
      throw new Error(
        "MELI_WEBHOOK_ENABLED requires MELI_ENABLED, MELI_APPLICATION_ID and MELI_WEBHOOK_TOKEN.",
      );
    }
    if (config.MELI_WEBHOOK_TOKEN.length < 32) {
      throw new Error("MELI_WEBHOOK_TOKEN must contain at least 32 characters.");
    }
  }
  if (!config.MELI_ENABLED) return;
  if (
    !config.MELI_CLIENT_ID ||
    !config.MELI_CLIENT_SECRET ||
    !config.MELI_REDIRECT_URI ||
    !config.MELI_TOKEN_VAULT_KEY_BASE64 ||
    !config.MELI_PLASTICOV_SELLER_ID ||
    !config.MELI_MAUSTIAN_SELLER_ID
  ) {
    throw new Error(
      "MELI_ENABLED requires client credentials, redirect URI, a 32-byte vault key and both Chile seller IDs.",
    );
  }
  if (config.MELI_PLASTICOV_SELLER_ID === config.MELI_MAUSTIAN_SELLER_ID) {
    throw new Error("Plasticov and Maustian must use different MercadoLibre seller IDs.");
  }
  if (Buffer.from(config.MELI_TOKEN_VAULT_KEY_BASE64, "base64").length !== 32) {
    throw new Error("MELI_TOKEN_VAULT_KEY_BASE64 must decode to exactly 32 bytes.");
  }
  const authorizationUrl = new URL(config.MELI_AUTHORIZATION_URL);
  if (authorizationUrl.hostname !== "auth.mercadolibre.cl") {
    throw new Error("MELI_AUTHORIZATION_URL must use the MercadoLibre Chile authorization host.");
  }
  if (config.NODE_ENV === "production" && new URL(config.MELI_REDIRECT_URI).protocol !== "https:") {
    throw new Error("MELI_REDIRECT_URI must use HTTPS in production.");
  }
}

function validateExternalUrl(value: string, label: string, nodeEnv: string): void {
  const url = new URL(value);
  if (url.username || url.password || url.hash) {
    throw new Error(`${label} cannot embed credentials or a fragment.`);
  }
  if (nodeEnv === "production" && url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS in production.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
