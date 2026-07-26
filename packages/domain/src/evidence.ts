export type EvidenceFreshness = "fresh" | "stale" | "unknown";
export type EvidenceConfidence = "low" | "medium" | "high";

export type EvidenceReference = Readonly<{
  id: string;
  source: string;
  sourceRecordId: string;
  observedAt: string;
  freshness: EvidenceFreshness;
  confidence: EvidenceConfidence;
  contentHash: string;
}>;

export type EvidenceBundle = Readonly<{
  id: string;
  accountId: string;
  references: readonly EvidenceReference[];
  complete: boolean;
  missingInputs: readonly string[];
}>;

export function assertCompleteEvidence(bundle: EvidenceBundle): void {
  if (!bundle.complete || bundle.missingInputs.length > 0 || bundle.references.length === 0) {
    throw new Error(`Evidence incomplete: ${bundle.missingInputs.join(", ") || "no references"}`);
  }
}
