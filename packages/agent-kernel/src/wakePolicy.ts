import { createHash } from "node:crypto";

export type Signal = Readonly<{
  kind: string;
  entityId: string;
  observedAt: string;
  materialValue: string | number | boolean | null;
  urgency: number;
  expectedImpact: number;
  confidence: number;
}>;

export type WakeDecision = Readonly<{
  shouldWake: boolean;
  reason: "manual" | "new-signals" | "cooldown" | "unchanged" | "negative-utility";
  signalsHash: string;
  expectedUtility: number;
}>;

export function decideWake(input: {
  signals: readonly Signal[];
  previousSignalsHash?: string;
  cooldownUntil?: string;
  now: string;
  estimatedCost: number;
  manual?: boolean;
}): WakeDecision {
  const signalsHash = createHash("sha256")
    .update(
      JSON.stringify(
        [...input.signals]
          .sort((a, b) => `${a.kind}:${a.entityId}`.localeCompare(`${b.kind}:${b.entityId}`))
          .map(({ observedAt: _observedAt, ...stable }) => stable),
      ),
    )
    .digest("hex");

  const expectedUtility =
    input.signals.reduce(
      (total, signal) => total + signal.urgency * signal.expectedImpact * signal.confidence,
      0,
    ) - input.estimatedCost;

  if (input.manual) return { shouldWake: true, reason: "manual", signalsHash, expectedUtility };
  if (input.cooldownUntil && Date.parse(input.cooldownUntil) > Date.parse(input.now)) {
    return { shouldWake: false, reason: "cooldown", signalsHash, expectedUtility };
  }
  if (input.previousSignalsHash === signalsHash) {
    return { shouldWake: false, reason: "unchanged", signalsHash, expectedUtility };
  }
  if (expectedUtility <= 0) {
    return { shouldWake: false, reason: "negative-utility", signalsHash, expectedUtility };
  }
  return { shouldWake: true, reason: "new-signals", signalsHash, expectedUtility };
}
