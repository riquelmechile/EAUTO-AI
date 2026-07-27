export const AGENT_DEPARTMENTS = [
  "executive",
  "finance",
  "portfolio",
  "supply",
  "operations",
  "growth",
  "expansion",
  "governance",
] as const;
export type AgentDepartmentId = (typeof AGENT_DEPARTMENTS)[number];

export const AGENT_LEVELS = ["ceo", "director", "specialist"] as const;
export type AgentLevel = (typeof AGENT_LEVELS)[number];

export const AGENT_AUTONOMY_LEVELS = ["ask", "inform", "autonomous"] as const;
export type AgentAutonomyLevel = (typeof AGENT_AUTONOMY_LEVELS)[number];

export const AGENT_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type AgentRiskLevel = (typeof AGENT_RISK_LEVELS)[number];

export type AgentRoleContract = Readonly<{
  id: string;
  version: string;
  label: string;
  level: AgentLevel;
  departmentId: AgentDepartmentId;
  parentAgentId: string | null;
  mission: string;
  inputs: readonly string[];
  outputs: readonly string[];
  requiredEvidenceKinds: readonly string[];
  allowedCapabilities: readonly string[];
  forbiddenCapabilities: readonly string[];
  skillIds: readonly string[];
  defaultAutonomy: AgentAutonomyLevel;
  riskLevel: AgentRiskLevel;
  maximumIterations: number;
  timeoutMs: number;
  maximumDailyBudgetMinorClp: number;
  stablePromptVersion: string;
  active: boolean;
}>;

export type AgentSkillManifest = Readonly<{
  id: string;
  version: string;
  label: string;
  description: string;
  riskLevel: AgentRiskLevel;
  allowedCapabilities: readonly string[];
  forbiddenCapabilities: readonly string[];
  requiredEvidenceKinds: readonly string[];
  maximumIterations: number;
  timeoutMs: number;
  requiresHumanApproval: boolean;
  cacheClass: "global-stable" | "agent-versioned" | "task-volatile";
}>;

export type AgentWorkSessionStatus =
  | "queued"
  | "running"
  | "waiting-evidence"
  | "waiting-approval"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentWorkSession = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  objectiveId: string;
  agentId: string;
  parentSessionId: string | null;
  delegationDepth: 0 | 1 | 2;
  status: AgentWorkSessionStatus;
  requestedAction: string;
  expectedEvidenceKinds: readonly string[];
  evidenceRefs: readonly string[];
  outputRefs: readonly string[];
  policyVersion: string;
  skillVersions: readonly string[];
  promptPrefixHash: string;
  idempotencyKey: string;
  budgetMinorClp: number;
  spentMinorClp: number;
  maximumIterations: number;
  iterationCount: number;
  startedAt: string | null;
  heartbeatAt: string | null;
  deadlineAt: string;
  completedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type AgentScorecard = Readonly<{
  organizationId: string;
  accountId: string;
  agentId: string;
  periodStart: string;
  periodEnd: string;
  runCount: number;
  completedCount: number;
  verifiedOutcomeCount: number;
  failedCount: number;
  policyViolationCount: number;
  humanCorrectionCount: number;
  totalCostMinorClp: number;
  verifiedOutcomeValueMinorClp: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  recommendedAutonomy: AgentAutonomyLevel;
  generatedAt: string;
}>;

export type AgentPreflightStatus = "allow" | "ask" | "deny";

export type AgentPreflightReport = Readonly<{
  status: AgentPreflightStatus;
  organizationId: string;
  accountId: string;
  agentId: string;
  requestedAction: string;
  contractVersion: string;
  contractHash: string;
  skillHashes: readonly string[];
  autonomy: AgentAutonomyLevel;
  riskLevel: AgentRiskLevel;
  evidenceComplete: boolean;
  missingEvidenceKinds: readonly string[];
  budgetAllowed: boolean;
  policyAllowed: boolean;
  delegationAllowed: boolean;
  reasons: readonly string[];
  stableContextRefs: readonly string[];
  volatileContextRefs: readonly string[];
  generatedAt: string;
}>;

export type AgentPlanTask = Readonly<{
  id: string;
  agentId: string;
  action: string;
  priority: "high" | "medium" | "low";
  dependsOn: readonly string[];
  expectedEvidenceKinds: readonly string[];
  requiresApproval: boolean;
  budgetMinorClp: number;
}>;

export type AgentPlan = Readonly<{
  objective: string;
  confidence: number;
  tasks: readonly AgentPlanTask[];
  requiresClarification: boolean;
  clarificationReason: string | null;
}>;

export function assertValidAgentContract(contract: AgentRoleContract): void {
  if (!contract.id.trim() || !contract.version.trim() || !contract.mission.trim()) {
    throw new Error("Agent contracts require id, version and mission.");
  }
  if (!Number.isInteger(contract.maximumIterations) || contract.maximumIterations < 1) {
    throw new Error(`Agent ${contract.id} requires a positive maximumIterations.`);
  }
  if (!Number.isInteger(contract.timeoutMs) || contract.timeoutMs < 1_000) {
    throw new Error(`Agent ${contract.id} requires timeoutMs >= 1000.`);
  }
  if (
    !Number.isSafeInteger(contract.maximumDailyBudgetMinorClp) ||
    contract.maximumDailyBudgetMinorClp < 0
  ) {
    throw new Error(`Agent ${contract.id} has an invalid CLP budget.`);
  }
  if (contract.level === "ceo" && contract.parentAgentId !== null) {
    throw new Error("The CEO agent cannot have a parent agent.");
  }
  if (contract.level !== "ceo" && contract.parentAgentId === null) {
    throw new Error(`Agent ${contract.id} requires a parent agent.`);
  }
  if (contract.level === "ceo" && contract.departmentId !== "executive") {
    throw new Error("The CEO agent must belong to the executive department.");
  }
}

export function assertValidAgentHierarchy(contracts: readonly AgentRoleContract[]): void {
  const byId = new Map(contracts.map((contract) => [contract.id, contract]));
  const ceos = contracts.filter((contract) => contract.level === "ceo");
  if (ceos.length !== 1) throw new Error("The company requires exactly one CEO agent.");

  for (const contract of contracts) {
    assertValidAgentContract(contract);
    if (contract.parentAgentId === null) continue;
    const parent = byId.get(contract.parentAgentId);
    if (!parent) throw new Error(`Agent ${contract.id} references an unknown parent.`);
    if (contract.level === "director" && parent.level !== "ceo") {
      throw new Error(`Director ${contract.id} must report directly to the CEO.`);
    }
    if (contract.level === "specialist" && parent.level !== "director") {
      throw new Error(`Specialist ${contract.id} must report to a director.`);
    }
  }
}
