import type { EvidenceDocument, EvidenceSubject } from "./operationalIntelligence.js";

export const AGENT_MESSAGE_KINDS = ["command", "event", "query", "response"] as const;
export type AgentMessageKind = (typeof AGENT_MESSAGE_KINDS)[number];

export const AGENT_MESSAGE_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
  "dead",
] as const;
export type AgentMessageStatus = (typeof AGENT_MESSAGE_STATUSES)[number];

export type AgentMessage = Readonly<{
  id: string;
  idempotencyKey: string;
  organizationId: string;
  accountId: string;
  conversationId: string;
  correlationId: string;
  causationId: string | null;
  senderAgentId: string;
  recipientAgentId: string;
  kind: AgentMessageKind;
  subject: string;
  payload: unknown;
  evidenceRefs: readonly string[];
  status: AgentMessageStatus;
  attempts: number;
  maximumAttempts: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseUntil: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  contentHash: string;
}>;

export const EVIDENCE_REQUEST_STATUSES = [
  "queued",
  "processing",
  "fulfilled",
  "incomplete",
  "failed",
  "dead",
] as const;
export type EvidenceRequestStatus = (typeof EVIDENCE_REQUEST_STATUSES)[number];

export type EvidenceRequest = Readonly<{
  id: string;
  idempotencyKey: string;
  organizationId: string;
  accountId: string;
  conversationId: string;
  correlationId: string;
  requesterAgentId: string;
  responderId: string;
  subject: EvidenceSubject;
  purpose: string;
  requiredKinds: readonly string[];
  maximumAgeMs: number;
  status: EvidenceRequestStatus;
  attempts: number;
  maximumAttempts: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseUntil: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  contentHash: string;
}>;

export type EvidenceResponse = Readonly<{
  id: string;
  requestId: string;
  organizationId: string;
  accountId: string;
  responderId: string;
  subject: EvidenceSubject;
  documents: readonly EvidenceDocument[];
  missingInputs: readonly string[];
  complete: boolean;
  generatedAt: string;
  expiresAt: string;
  contentHash: string;
}>;

export const SEMANTIC_MEMORY_STATUSES = [
  "active",
  "needs-review",
  "conflicted",
  "superseded",
] as const;
export type SemanticMemoryStatus = (typeof SEMANTIC_MEMORY_STATUSES)[number];

export type SemanticMemoryEntry = Readonly<{
  id: string;
  organizationId: string;
  accountId: string | null;
  topicKey: string;
  title: string;
  observation: string;
  rationale: string;
  scopeDescription: string;
  keywords: readonly string[];
  sourceRefs: readonly string[];
  confidence: "low" | "medium" | "high";
  verifiedOutcome: boolean;
  status: SemanticMemoryStatus;
  revision: number;
  supersedesId: string | null;
  conflictsWithIds: readonly string[];
  createdAt: string;
  expiresAt: string | null;
  contentHash: string;
}>;

export type SemanticMemorySearchResult = Readonly<{
  entry: SemanticMemoryEntry;
  rank: number;
  matchedTerms: readonly string[];
}>;

export type SemanticMemoryAdmissionDecision = Readonly<{
  admitted: boolean;
  reason:
    | "admitted"
    | "organization-mismatch"
    | "account-mismatch"
    | "expired"
    | "missing-provenance"
    | "unverified-outcome"
    | "needs-review"
    | "conflicted"
    | "superseded";
}>;

export type SemanticMemoryReconciliation = Readonly<{
  status: "new" | "compatible" | "supersedes" | "conflicts";
  relatedIds: readonly string[];
}>;

export function decideSemanticMemoryAdmission(input: {
  entry: SemanticMemoryEntry;
  organizationId: string;
  accountId: string;
  now: string;
  requireVerifiedOutcome?: boolean;
}): SemanticMemoryAdmissionDecision {
  if (input.entry.organizationId !== input.organizationId) {
    return { admitted: false, reason: "organization-mismatch" };
  }
  if (input.entry.accountId !== null && input.entry.accountId !== input.accountId) {
    return { admitted: false, reason: "account-mismatch" };
  }
  if (input.entry.expiresAt && Date.parse(input.entry.expiresAt) <= Date.parse(input.now)) {
    return { admitted: false, reason: "expired" };
  }
  if (input.entry.sourceRefs.length === 0) {
    return { admitted: false, reason: "missing-provenance" };
  }
  if (input.requireVerifiedOutcome === true && !input.entry.verifiedOutcome) {
    return { admitted: false, reason: "unverified-outcome" };
  }
  if (input.entry.status !== "active") {
    return { admitted: false, reason: input.entry.status };
  }
  return { admitted: true, reason: "admitted" };
}

export function reconcileSemanticMemory(input: {
  candidateTopicKey: string;
  candidateSourceRefs: readonly string[];
  existing: readonly SemanticMemoryEntry[];
  supersedesId?: string;
  conflictsWithIds?: readonly string[];
}): SemanticMemoryReconciliation {
  const sameTopic = input.existing.filter((entry) => entry.topicKey === input.candidateTopicKey);
  if (input.supersedesId) {
    const target = sameTopic.find((entry) => entry.id === input.supersedesId);
    if (!target) throw new Error("Semantic memory supersedes target must exist in the same topic.");
    return { status: "supersedes", relatedIds: Object.freeze([target.id]) };
  }
  const conflicts = Object.freeze(
    [...new Set(input.conflictsWithIds ?? [])].filter((id) =>
      sameTopic.some((entry) => entry.id === id),
    ),
  );
  if (conflicts.length > 0) return { status: "conflicts", relatedIds: conflicts };
  if (sameTopic.length === 0) return { status: "new", relatedIds: Object.freeze([]) };
  const candidateRefs = new Set(input.candidateSourceRefs);
  const compatible = sameTopic.filter((entry) =>
    entry.sourceRefs.some((reference) => candidateRefs.has(reference)),
  );
  return {
    status: "compatible",
    relatedIds: Object.freeze(
      (compatible.length > 0 ? compatible : sameTopic).map((entry) => entry.id),
    ),
  };
}

export function assertCollaborationScope(
  value: Readonly<{ organizationId: string; accountId: string }>,
  organizationId: string,
  accountId: string,
): void {
  if (value.organizationId !== organizationId || value.accountId !== accountId) {
    throw new Error("Agent collaboration scope mismatch.");
  }
}
