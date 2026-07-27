import type { EvidenceReference } from "./evidence.js";
import type { LlmTaskClass } from "./llm.js";

export const EVIDENCE_AUTHORITIES = ["authoritative", "derived", "advisory"] as const;
export type EvidenceAuthority = (typeof EVIDENCE_AUTHORITIES)[number];

export const EVIDENCE_SUBJECTS = [
  "catalog",
  "customer",
  "commercial",
  "economic",
  "reputation",
  "content",
  "system",
] as const;
export type EvidenceSubject = (typeof EVIDENCE_SUBJECTS)[number];

export type EvidenceDocument = Readonly<{
  reference: EvidenceReference;
  subject: EvidenceSubject;
  authority: EvidenceAuthority;
  expiresAt: string;
  payload: unknown;
}>;

export type OperationalEvidencePack = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  purpose: string;
  subject: EvidenceSubject;
  generatedAt: string;
  expiresAt: string;
  documents: readonly EvidenceDocument[];
  complete: boolean;
  missingInputs: readonly string[];
  contentHash: string;
}>;

export const MEMORY_KINDS = [
  "verified-outcome",
  "decision",
  "preference",
  "lesson",
  "summary",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type ConsultativeMemoryRecord = Readonly<{
  id: string;
  organizationId: string;
  accountId: string | null;
  kind: MemoryKind;
  content: string;
  sourceRefs: readonly string[];
  confidence: "low" | "medium" | "high";
  verifiedOutcome: boolean;
  createdAt: string;
  expiresAt: string | null;
  contentHash: string;
}>;

export type MemoryAdmissionDecision = Readonly<{
  admitted: boolean;
  reason:
    | "admitted"
    | "organization-mismatch"
    | "account-mismatch"
    | "expired"
    | "unverified-outcome"
    | "missing-provenance";
}>;

export const WORK_ORDER_STATUSES = [
  "queued",
  "processing",
  "waiting-evidence",
  "waiting-approval",
  "completed",
  "failed",
  "dead",
  "skipped",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export type AgentWorkOrder = Readonly<{
  id: string;
  idempotencyKey: string;
  organizationId: string;
  accountId: string;
  objectiveId: string;
  agentId: string;
  taskClass: LlmTaskClass;
  requestedAction: string;
  evidencePackId: string;
  memoryRefs: readonly string[];
  signalsHash: string;
  expectedUtility: number;
  wakeReason: string;
  status: WorkOrderStatus;
  budgetMinorClp: number;
  budgetMicrosUsd: number;
  maximumAttempts: number;
  attempts: number;
  availableAt: string;
  cooldownUntil: string | null;
  leaseOwner: string | null;
  leaseUntil: string | null;
  sessionId: string | null;
  outputRefs: readonly string[];
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}>;

export const SHADOW_PROPOSAL_STATUSES = [
  "pending-approval",
  "approved",
  "rejected",
  "superseded",
] as const;
export type ShadowProposalStatus = (typeof SHADOW_PROPOSAL_STATUSES)[number];

export type ShadowProposalRecord = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  workOrderId: string;
  sessionId: string;
  llmRunId: string;
  agentId: string;
  action: string;
  rationale: string;
  evidenceRefs: readonly string[];
  expectedImpactMinorClp: number | null;
  risk: "low" | "medium" | "high" | "critical";
  requiresHumanApproval: true;
  status: ShadowProposalStatus;
  contentHash: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}>;

export function assertUsableEvidencePack(pack: OperationalEvidencePack, now: string): void {
  if (!pack.complete || pack.documents.length === 0 || pack.missingInputs.length > 0) {
    throw new Error(`Evidence pack ${pack.id} is incomplete.`);
  }
  if (Date.parse(pack.expiresAt) <= Date.parse(now)) {
    throw new Error(`Evidence pack ${pack.id} is expired.`);
  }
  const invalid = pack.documents.find(
    (document) =>
      document.authority === "advisory" ||
      Date.parse(document.expiresAt) <= Date.parse(now) ||
      document.reference.freshness !== "fresh",
  );
  if (invalid) throw new Error(`Evidence document ${invalid.reference.id} is not authoritative and fresh.`);
}

export function decideMemoryAdmission(input: {
  record: ConsultativeMemoryRecord;
  organizationId: string;
  accountId: string;
  now: string;
  requireVerifiedOutcome?: boolean;
}): MemoryAdmissionDecision {
  if (input.record.organizationId !== input.organizationId) {
    return { admitted: false, reason: "organization-mismatch" };
  }
  if (input.record.accountId !== null && input.record.accountId !== input.accountId) {
    return { admitted: false, reason: "account-mismatch" };
  }
  if (input.record.expiresAt && Date.parse(input.record.expiresAt) <= Date.parse(input.now)) {
    return { admitted: false, reason: "expired" };
  }
  if (input.record.sourceRefs.length === 0) {
    return { admitted: false, reason: "missing-provenance" };
  }
  if (
    input.requireVerifiedOutcome === true &&
    input.record.kind === "verified-outcome" &&
    !input.record.verifiedOutcome
  ) {
    return { admitted: false, reason: "unverified-outcome" };
  }
  return { admitted: true, reason: "admitted" };
}
