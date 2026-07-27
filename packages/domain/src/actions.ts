import type { EvidenceBundle } from "./evidence.js";

export const ACTION_KINDS = [
  "listing.publish",
  "listing.update",
  "price.update",
  "stock.update",
  "question.answer",
  "claim.respond",
  "ads.update",
  "social.publish",
  "medusa.sync",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

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
  | "uncertain"
  | "rejected"
  | "expired";

export type ExactChange = Readonly<{ field: string; from: unknown; to: unknown }>;

export type BusinessAction = Readonly<{
  id: string;
  accountId: string;
  kind: ActionKind;
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
  executing: ["executed", "failed", "uncertain"],
  executed: ["verified", "failed", "uncertain"],
  verified: [],
  failed: [],
  uncertain: [],
  rejected: [],
  expired: [],
});

export function transitionAction(action: BusinessAction, to: ActionStatus): BusinessAction {
  if (!transitions[action.status].includes(to)) {
    throw new Error(`Invalid action transition ${action.status} -> ${to}.`);
  }
  return Object.freeze({ ...action, status: to });
}
