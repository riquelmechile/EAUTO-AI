import type { EvidenceBundle } from "./evidence.js";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ActionStatus =
  | "draft"
  | "proposed"
  | "reviewed"
  | "approved"
  | "executing"
  | "executed"
  | "verified"
  | "failed"
  | "rejected"
  | "expired";

export type ExactChange = Readonly<{ field: string; from: unknown; to: unknown }>;

export type BusinessAction = Readonly<{
  id: string;
  accountId: string;
  kind: string;
  target: string;
  exactChanges: readonly ExactChange[];
  rationale: string;
  risk: RiskLevel;
  status: ActionStatus;
  evidenceBundle: EvidenceBundle;
  policyVersion: string;
  expiresAt: string;
}>;

export type Approval = Readonly<{
  id: string;
  actionId: string;
  actionHash: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
}>;

const transitions: Readonly<Record<ActionStatus, readonly ActionStatus[]>> = Object.freeze({
  draft: ["proposed"],
  proposed: ["reviewed", "rejected", "expired"],
  reviewed: ["approved", "rejected", "expired"],
  approved: ["executing", "expired"],
  executing: ["executed", "failed"],
  executed: ["verified", "failed"],
  verified: [],
  failed: [],
  rejected: [],
  expired: [],
});

export function transitionAction(action: BusinessAction, to: ActionStatus): BusinessAction {
  if (!transitions[action.status].includes(to)) {
    throw new Error(`Invalid action transition ${action.status} -> ${to}.`);
  }
  return Object.freeze({ ...action, status: to });
}
