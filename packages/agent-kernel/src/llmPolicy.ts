import type { LlmModelId, LlmTaskClass } from "@eauto/domain";
import { estimateModelCost, type ModelPricing } from "./cost.js";
import type { CompiledPrompt } from "./promptCompiler.js";

export const DEEPSEEK_PRICING_VERSION = "2026-07-26";

export const DEEPSEEK_MODEL_PRICING: Readonly<Record<LlmModelId, ModelPricing>> = Object.freeze({
  "deepseek-v4-flash": Object.freeze({
    currency: "USD",
    cacheHitMicrosPerMillion: 2_800,
    cacheMissMicrosPerMillion: 140_000,
    outputMicrosPerMillion: 280_000,
  }),
  "deepseek-v4-pro": Object.freeze({
    currency: "USD",
    cacheHitMicrosPerMillion: 3_625,
    cacheMissMicrosPerMillion: 435_000,
    outputMicrosPerMillion: 870_000,
  }),
});

export type LlmRoutingPolicy = Readonly<{
  flashTaskClasses: readonly LlmTaskClass[];
  proTaskClasses: readonly LlmTaskClass[];
  maximumInputTokens: number;
  maximumOutputTokens: number;
}>;

export const DEFAULT_LLM_ROUTING_POLICY: LlmRoutingPolicy = Object.freeze({
  flashTaskClasses: Object.freeze(["classification", "extraction", "summarization"]),
  proTaskClasses: Object.freeze(["planning", "analysis", "critical-review"]),
  maximumInputTokens: 200_000,
  maximumOutputTokens: 8_000,
});

export function routeLlmModel(
  taskClass: LlmTaskClass,
  policy: LlmRoutingPolicy = DEFAULT_LLM_ROUTING_POLICY,
): LlmModelId {
  if (policy.flashTaskClasses.includes(taskClass)) return "deepseek-v4-flash";
  if (policy.proTaskClasses.includes(taskClass)) return "deepseek-v4-pro";
  throw new Error(`No LLM model route exists for task class ${taskClass}.`);
}

export function estimateMaximumLlmCost(input: {
  model: LlmModelId;
  maximumPromptTokens: number;
  maximumOutputTokens: number;
}): number {
  validateTokenLimit(input.maximumPromptTokens, "maximumPromptTokens");
  validateTokenLimit(input.maximumOutputTokens, "maximumOutputTokens");
  return estimateModelCost(DEEPSEEK_MODEL_PRICING[input.model], {
    cacheHitTokens: 0,
    cacheMissTokens: input.maximumPromptTokens,
    outputTokens: input.maximumOutputTokens,
  });
}

export type ProviderMessage = Readonly<{
  role: "system" | "user";
  content: string;
}>;

export function compileProviderMessages(prompt: CompiledPrompt): readonly ProviderMessage[] {
  return Object.freeze([
    Object.freeze({ role: "system", content: prompt.stablePrefix }),
    Object.freeze({
      role: "user",
      content: [
        "# Retrieved Context",
        prompt.recoveredContext || "No retrieved context was admitted.",
        "# Current Work",
        prompt.volatileInput,
        "# Output Contract",
        "Return one valid JSON object only. Never claim an action was executed. Every finding and proposal must cite evidenceRefs. Set requiresHumanApproval to true for every proposal.",
      ].join("\n\n"),
    }),
  ]);
}

function validateTokenLimit(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
}
