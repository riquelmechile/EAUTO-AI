import { z } from "zod";

const bool = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}, z.boolean());

const optional = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const schema = z.object({
  COMPANY_INTELLIGENCE_ENABLED: bool.default(false),
  COMPANY_INTELLIGENCE_WORKER_ID: z.string().min(1).default("eauto-company-intelligence"),
  COMPANY_INTELLIGENCE_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(60_000)
    .default(2_000),
  COMPANY_INTELLIGENCE_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  COMPANY_INTELLIGENCE_LEASE_MS: z.coerce.number().int().min(5_000).max(300_000).default(60_000),
  COMPANY_INTELLIGENCE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  COMPANY_INTELLIGENCE_MAX_EVIDENCE_AGE_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .default(15 * 60_000),
  COMPANY_INTELLIGENCE_ACCOUNT_IDS: z.string().default("plasticov"),
  CONTENT_PROVIDER_KIND: z.enum(["generic", "minimax"]).default("generic"),
  MINIMAX_API_KEY: optional,
  MINIMAX_IMAGE_MODEL: z.string().min(1).default("image-01"),
  MINIMAX_VIDEO_MODEL: z.string().min(1).default("MiniMax-Hailuo-2.3"),
  MINIMAX_GENERATE_VIDEO: bool.default(false),
  MINIMAX_PROMPT_VERSION: z.string().min(1).max(128).default("eauto-commerce-v1"),
  MINIMAX_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  MINIMAX_MAXIMUM_POLLS: z.coerce.number().int().min(1).max(720).default(120),
});

export type CompanyIntelligenceConfig = z.infer<typeof schema> & {
  readonly accountIds: readonly string[];
};

export function loadCompanyIntelligenceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CompanyIntelligenceConfig {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Invalid company intelligence environment: ${parsed.error.message}`);
  }
  const accountIds = Object.freeze([
    ...new Set(
      parsed.data.COMPANY_INTELLIGENCE_ACCOUNT_IDS.split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]);
  const inheritedContentKey = environment.CONTENT_PROVIDER_API_KEY?.trim() || undefined;
  const miniMaxApiKey = parsed.data.MINIMAX_API_KEY ?? inheritedContentKey;
  if (parsed.data.COMPANY_INTELLIGENCE_ENABLED && accountIds.length === 0) {
    throw new Error("COMPANY_INTELLIGENCE_ENABLED requires at least one account ID.");
  }
  if (parsed.data.CONTENT_PROVIDER_KIND === "minimax" && !miniMaxApiKey) {
    throw new Error(
      "CONTENT_PROVIDER_KIND=minimax requires MINIMAX_API_KEY or CONTENT_PROVIDER_API_KEY.",
    );
  }
  if (
    environment.NODE_ENV === "production" &&
    accountIds.some((accountId) => accountId !== "plasticov")
  ) {
    throw new Error(
      "The first company-intelligence production rollout is restricted to Plasticov.",
    );
  }
  return Object.freeze({ ...parsed.data, MINIMAX_API_KEY: miniMaxApiKey, accountIds });
}
