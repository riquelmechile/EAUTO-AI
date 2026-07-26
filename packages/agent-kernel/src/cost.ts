export type ModelPricing = Readonly<{
  currency: "USD";
  cacheHitMicrosPerMillion: number;
  cacheMissMicrosPerMillion: number;
  outputMicrosPerMillion: number;
}>;

export type TokenUsage = Readonly<{
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
}>;

export function estimateModelCost(pricing: ModelPricing, usage: TokenUsage): number {
  validateUsage(usage);
  return Math.ceil(
    (usage.cacheHitTokens * pricing.cacheHitMicrosPerMillion +
      usage.cacheMissTokens * pricing.cacheMissMicrosPerMillion +
      usage.outputTokens * pricing.outputMicrosPerMillion) /
      1_000_000,
  );
}

function validateUsage(usage: TokenUsage): void {
  for (const value of Object.values(usage)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid token usage.");
  }
}
