import { createHash } from "node:crypto";
import type {
  AgentAutonomyLevel,
  AgentPreflightReport,
  AgentRoleContract,
  AgentSkillManifest,
} from "@eauto/domain";

export type AgentPreflightInput = Readonly<{
  organizationId: string;
  accountId: string;
  contract: AgentRoleContract;
  skills: readonly AgentSkillManifest[];
  requestedAction: string;
  availableEvidenceKinds: readonly string[];
  autonomy: AgentAutonomyLevel;
  delegationDepth: number;
  requestedBudgetMinorClp: number;
  spentTodayMinorClp: number;
  policyAllowed: boolean;
  stableContextRefs: readonly string[];
  volatileContextRefs: readonly string[];
  generatedAt: string;
}>;

export function runAgentPreflight(input: AgentPreflightInput): AgentPreflightReport {
  const skillById = new Map(input.skills.map((skill) => [skill.id, skill]));
  const selectedSkills = input.contract.skillIds.map((skillId) => {
    const skill = skillById.get(skillId);
    if (!skill) throw new Error(`Agent ${input.contract.id} references unknown skill ${skillId}.`);
    return skill;
  });
  const requiredEvidenceKinds = new Set([
    ...input.contract.requiredEvidenceKinds,
    ...selectedSkills.flatMap((skill) => skill.requiredEvidenceKinds),
  ]);
  const available = new Set(input.availableEvidenceKinds);
  const missingEvidenceKinds = [...requiredEvidenceKinds].filter((kind) => !available.has(kind));
  const forbidden = new Set([
    ...input.contract.forbiddenCapabilities,
    ...selectedSkills.flatMap((skill) => skill.forbiddenCapabilities),
  ]);
  const allowed = new Set([
    ...input.contract.allowedCapabilities,
    ...selectedSkills.flatMap((skill) => skill.allowedCapabilities),
  ]);
  const actionAllowed = allowed.has(input.requestedAction) && !forbidden.has(input.requestedAction);
  const budgetAllowed =
    Number.isSafeInteger(input.requestedBudgetMinorClp) &&
    input.requestedBudgetMinorClp >= 0 &&
    input.spentTodayMinorClp + input.requestedBudgetMinorClp <=
      input.contract.maximumDailyBudgetMinorClp;
  const delegationAllowed =
    Number.isInteger(input.delegationDepth) &&
    input.delegationDepth >= 0 &&
    input.delegationDepth <= 2 &&
    (input.contract.level === "ceo"
      ? input.delegationDepth === 0
      : input.contract.level === "director"
        ? input.delegationDepth === 1
        : input.delegationDepth === 2);
  const evidenceComplete = missingEvidenceKinds.length === 0;
  const approvalRequired = selectedSkills.some((skill) => skill.requiresHumanApproval);
  const reasons: string[] = [];

  if (!input.contract.active) reasons.push("agent-inactive");
  if (!actionAllowed) reasons.push("capability-not-allowed");
  if (!input.policyAllowed) reasons.push("policy-denied");
  if (!budgetAllowed) reasons.push("budget-exceeded");
  if (!delegationAllowed) reasons.push("delegation-depth-invalid");
  if (!evidenceComplete) reasons.push("missing-evidence");
  if (
    input.autonomy === "autonomous" &&
    (approvalRequired || input.contract.riskLevel === "critical")
  ) {
    reasons.push("human-approval-required");
  }

  const hardDenied =
    !input.contract.active ||
    !actionAllowed ||
    !input.policyAllowed ||
    !budgetAllowed ||
    !delegationAllowed;
  const status = hardDenied
    ? "deny"
    : !evidenceComplete ||
        (input.autonomy === "ask" && input.requestedAction !== "evidence.request") ||
        reasons.includes("human-approval-required")
      ? "ask"
      : "allow";

  return Object.freeze({
    status,
    organizationId: input.organizationId,
    accountId: input.accountId,
    agentId: input.contract.id,
    requestedAction: input.requestedAction,
    contractVersion: input.contract.version,
    contractHash: hashCanonical(input.contract),
    skillHashes: Object.freeze(selectedSkills.map(hashCanonical).sort()),
    autonomy: input.autonomy,
    riskLevel: input.contract.riskLevel,
    evidenceComplete,
    missingEvidenceKinds: Object.freeze(missingEvidenceKinds.sort()),
    budgetAllowed,
    policyAllowed: input.policyAllowed,
    delegationAllowed,
    reasons: Object.freeze(reasons),
    stableContextRefs: Object.freeze([...input.stableContextRefs]),
    volatileContextRefs: Object.freeze([...input.volatileContextRefs]),
    generatedAt: input.generatedAt,
  });
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}
