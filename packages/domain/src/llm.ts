export const LLM_RUN_STATUSES = [
  "prepared",
  "running",
  "completed",
  "failed",
  "blocked",
] as const;
export type LlmRunStatus = (typeof LLM_RUN_STATUSES)[number];

export const LLM_TASK_CLASSES = [
  "classification",
  "extraction",
  "summarization",
  "planning",
  "analysis",
  "critical-review",
] as const;
export type LlmTaskClass = (typeof LLM_TASK_CLASSES)[number];

export type LlmModelId = "deepseek-v4-flash" | "deepseek-v4-pro";

export type LlmTokenUsage = Readonly<{
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}>;

export type LlmRunRecord = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  agentId: string;
  sessionId: string;
  taskClass: LlmTaskClass;
  provider: "deepseek";
  model: LlmModelId;
  mode: "shadow";
  status: LlmRunStatus;
  stablePrefixHash: string;
  fullPromptHash: string;
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  budgetMicrosUsd: number;
  estimatedMaximumCostMicrosUsd: number;
  actualCostMicrosUsd: number | null;
  usage: LlmTokenUsage | null;
  cacheHitRatioBps: number | null;
  providerRequestId: string | null;
  systemFingerprint: string | null;
  outputHash: string | null;
  outputJson: unknown | null;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ShadowAgentOutput = Readonly<{
  summary: string;
  findings: readonly Readonly<{
    statement: string;
    evidenceRefs: readonly string[];
    confidence: "low" | "medium" | "high";
  }>[];
  proposals: readonly Readonly<{
    action: string;
    rationale: string;
    evidenceRefs: readonly string[];
    expectedImpactMinorClp: number | null;
    risk: "low" | "medium" | "high" | "critical";
    requiresHumanApproval: true;
  }>[];
  missingEvidenceKinds: readonly string[];
  stopReason: "completed" | "missing-evidence" | "budget" | "policy";
}>;

export function assertValidLlmUsage(usage: LlmTokenUsage): void {
  for (const [key, value] of Object.entries(usage)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid LLM usage field ${key}.`);
    }
  }
  if (usage.promptTokens !== usage.cacheHitTokens + usage.cacheMissTokens) {
    throw new Error("promptTokens must equal cacheHitTokens + cacheMissTokens.");
  }
  if (usage.totalTokens !== usage.promptTokens + usage.outputTokens) {
    throw new Error("totalTokens must equal promptTokens + outputTokens.");
  }
}

export function assertShadowAgentOutput(value: unknown): asserts value is ShadowAgentOutput {
  if (!isRecord(value)) throw new Error("Shadow agent output must be a JSON object.");
  if (typeof value.summary !== "string" || value.summary.trim().length === 0) {
    throw new Error("Shadow agent output requires a summary.");
  }
  if (!Array.isArray(value.findings) || !Array.isArray(value.proposals)) {
    throw new Error("Shadow agent output requires findings and proposals arrays.");
  }
  if (!Array.isArray(value.missingEvidenceKinds)) {
    throw new Error("Shadow agent output requires missingEvidenceKinds.");
  }
  if (!["completed", "missing-evidence", "budget", "policy"].includes(String(value.stopReason))) {
    throw new Error("Shadow agent output has an invalid stopReason.");
  }
  for (const finding of value.findings) {
    if (
      !isRecord(finding) ||
      typeof finding.statement !== "string" ||
      !Array.isArray(finding.evidenceRefs) ||
      !["low", "medium", "high"].includes(String(finding.confidence))
    ) {
      throw new Error("Shadow agent output contains an invalid finding.");
    }
  }
  for (const proposal of value.proposals) {
    if (
      !isRecord(proposal) ||
      typeof proposal.action !== "string" ||
      typeof proposal.rationale !== "string" ||
      !Array.isArray(proposal.evidenceRefs) ||
      !["low", "medium", "high", "critical"].includes(String(proposal.risk)) ||
      proposal.requiresHumanApproval !== true ||
      !(
        proposal.expectedImpactMinorClp === null ||
        (typeof proposal.expectedImpactMinorClp === "number" &&
          Number.isSafeInteger(proposal.expectedImpactMinorClp))
      )
    ) {
      throw new Error("Shadow agent output contains an invalid proposal.");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
