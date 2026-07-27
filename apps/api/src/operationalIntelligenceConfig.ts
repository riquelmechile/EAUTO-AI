import { z } from "zod";

const environmentBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}, z.boolean());

const schema = z.object({
  INTELLIGENCE_WORKER_ENABLED: environmentBoolean.default(false),
  INTELLIGENCE_WORKER_ID: z.string().min(1).default("eauto-intelligence"),
  INTELLIGENCE_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  INTELLIGENCE_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  INTELLIGENCE_LEASE_MS: z.coerce.number().int().min(5_000).max(300_000).default(60_000),
  INTELLIGENCE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  INTELLIGENCE_RETRY_BASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(5_000),
  INTELLIGENCE_RETRY_MAX_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(86_400_000)
    .default(900_000),
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
  INTELLIGENCE_DEFAULT_BUDGET_MINOR_CLP: z.coerce
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .default(0),
});

export type OperationalIntelligenceConfig = z.infer<typeof schema>;

export function loadOperationalIntelligenceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OperationalIntelligenceConfig {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Invalid operational intelligence environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
