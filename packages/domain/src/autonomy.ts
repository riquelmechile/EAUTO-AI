import type { RiskLevel } from "./actions.js";
import type { Money } from "./money.js";

export type AutonomyMode = "ask" | "inform" | "autonomous";

export type AutonomyPolicy = Readonly<{
  accountId: string;
  actionKind: string;
  mode: AutonomyMode;
  maximumRisk: RiskLevel;
  dailyBudget: Money;
  reversibleOnly: boolean;
  minimumVerifiedActions: number;
}>;

const riskOrder: Readonly<Record<RiskLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function canExecuteWithoutApproval(input: {
  policy: AutonomyPolicy;
  risk: RiskLevel;
  reversible: boolean;
  verifiedHistoryCount: number;
  spentToday: Money;
  estimatedCost: Money;
}): boolean {
  const { policy } = input;
  if (policy.mode !== "autonomous") return false;
  if (riskOrder[input.risk] > riskOrder[policy.maximumRisk]) return false;
  if (policy.reversibleOnly && !input.reversible) return false;
  if (input.verifiedHistoryCount < policy.minimumVerifiedActions) return false;
  if (input.spentToday.currency !== policy.dailyBudget.currency) return false;
  if (input.estimatedCost.currency !== policy.dailyBudget.currency) return false;
  return input.spentToday.amountMinor + input.estimatedCost.amountMinor <= policy.dailyBudget.amountMinor;
}
