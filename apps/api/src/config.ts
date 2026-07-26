import { z } from "zod";

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
  OUTBOX_WORKER_ID: z.string().min(1).default("eauto-outbox"),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  OUTBOX_LEASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),
  OUTBOX_BASE_RETRY_MS: z.coerce.number().int().min(100).max(300_000).default(1_000),
  OUTBOX_MAX_RETRY_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(300_000),
  MERCADOLIBRE_ENABLED: environmentBoolean.default(false),
  MERCADOLIBRE_CLIENT_ID: optionalString,
  MERCADOLIBRE_CLIENT_SECRET: optionalString,
  MERCADOLIBRE_REDIRECT_URI: optionalUrl,
  MERCADOLIBRE_VAULT_KEY_BASE64: optionalString,
  MERCADOLIBRE_AUTHORIZATION_BASE_URL: z.string().url().default("https://auth.mercadolibre.cl"),
  MERCADOLIBRE_API_BASE_URL: z.string().url().default("https://api.mercadolibre.com"),
  MERCADOLIBRE_STATE_TTL_MS: z.coerce.number().int().min(60_000).max(900_000).default(600_000),
  MERCADOLIBRE_REFRESH_LEASE_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(300_000)
    .default(30_000),
  MERCADOLIBRE_REFRESH_BEFORE_EXPIRY_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(3_600_000)
    .default(600_000),
  MERCADOLIBRE_HTTP_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(15_000),
  MERCADOLIBRE_MAXIMUM_SCAN_PAGES: z.coerce.number().int().min(1).max(1_000).default(100),
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

  if (parsed.data.MERCADOLIBRE_ENABLED) {
    if (
      !parsed.data.MERCADOLIBRE_CLIENT_ID ||
      !parsed.data.MERCADOLIBRE_CLIENT_SECRET ||
      !parsed.data.MERCADOLIBRE_REDIRECT_URI ||
      !parsed.data.MERCADOLIBRE_VAULT_KEY_BASE64
    ) {
      throw new Error(
        "Mercado Libre requires client ID, client secret, redirect URI and vault key when enabled.",
      );
    }
    const decodedKey = Buffer.from(parsed.data.MERCADOLIBRE_VAULT_KEY_BASE64, "base64");
    if (decodedKey.byteLength !== 32) {
      throw new Error("MERCADOLIBRE_VAULT_KEY_BASE64 must decode to exactly 32 bytes.");
    }
    if (
      parsed.data.NODE_ENV === "production" &&
      new URL(parsed.data.MERCADOLIBRE_REDIRECT_URI).protocol !== "https:"
    ) {
      throw new Error("MERCADOLIBRE_REDIRECT_URI must use HTTPS in production.");
    }
  }

  if (parsed.data.NODE_ENV === "production") {
    if (!parsed.data.DATABASE_URL) throw new Error("DATABASE_URL is mandatory in production.");
    if (parsed.data.AUTH_MODE !== "static-token") {
      throw new Error("AUTH_MODE=static-token is mandatory in production.");
    }
    if (operatorIdentities.length === 0) {
      throw new Error("At least one operator identity is mandatory in production.");
    }
    if (!parsed.data.OBJECT_STORAGE_PUBLIC_ENDPOINT) {
      throw new Error("OBJECT_STORAGE_PUBLIC_ENDPOINT is mandatory in production.");
    }
    if (new URL(parsed.data.OBJECT_STORAGE_PUBLIC_ENDPOINT).protocol !== "https:") {
      throw new Error("OBJECT_STORAGE_PUBLIC_ENDPOINT must use HTTPS in production.");
    }
  }

  return parsed.data;
}
