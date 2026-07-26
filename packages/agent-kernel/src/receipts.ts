import { createHash } from "node:crypto";

export type ReceiptType =
  "proposal" | "review" | "approval" | "execution" | "verification" | "outcome";

export type VerifiableReceipt = Readonly<{
  id: string;
  type: ReceiptType;
  accountId: string;
  actionId: string;
  contentHash: string;
  policyHash: string;
  evidenceHash: string;
  previousReceiptHash: string | null;
  payloadHash: string;
  chainHash: string;
  recordedAt: string;
}>;

export function createReceipt(
  input: Omit<VerifiableReceipt, "payloadHash" | "chainHash"> & {
    payload: unknown;
  },
): VerifiableReceipt {
  const payloadHash = digest(canonicalize(input.payload));
  const chainHash = digest(
    [
      input.type,
      input.accountId,
      input.actionId,
      input.contentHash,
      input.policyHash,
      input.evidenceHash,
      input.previousReceiptHash ?? "GENESIS",
      payloadHash,
      input.recordedAt,
    ].join("|"),
  );

  return Object.freeze({
    id: input.id,
    type: input.type,
    accountId: input.accountId,
    actionId: input.actionId,
    contentHash: input.contentHash,
    policyHash: input.policyHash,
    evidenceHash: input.evidenceHash,
    previousReceiptHash: input.previousReceiptHash,
    payloadHash,
    chainHash,
    recordedAt: input.recordedAt,
  });
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
