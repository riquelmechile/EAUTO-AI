import type { ActionKind } from "./actions.js";

export const MERCADOLIBRE_CHILE_SITE_ID = "MLC" as const;

export const MERCADOLIBRE_CONNECTION_STATUSES = [
  "active",
  "refreshing",
  "reauthorization-required",
  "revoked",
] as const;

export type MercadoLibreConnectionStatus = (typeof MERCADOLIBRE_CONNECTION_STATUSES)[number];

export type MercadoLibreConnection = Readonly<{
  organizationId: string;
  accountId: string;
  sellerId: string;
  nickname?: string;
  siteId: typeof MERCADOLIBRE_CHILE_SITE_ID;
  scopes: readonly string[];
  status: MercadoLibreConnectionStatus;
  expiresAt: string;
  lastSyncedAt?: string;
  updatedAt: string;
}>;

export type MercadoLibreListingSnapshot = Readonly<{
  organizationId: string;
  accountId: string;
  sellerId: string;
  itemId: string;
  title: string;
  status: string;
  priceMinor: number;
  currencyId: string;
  availableQuantity: number;
  soldQuantity: number;
  permalink?: string;
  observedAt: string;
  sourceHash: string;
}>;

/** Compact operational snapshot. Full messages and attachments are deliberately excluded. */
export type MercadoLibreClaimSnapshot = Readonly<{
  organizationId: string;
  accountId: string;
  sellerId: string;
  claimId: string;
  resourceId: string;
  resource: string;
  status: string;
  type: string;
  stage: string;
  reasonId?: string;
  fulfilled?: boolean;
  dateCreated: string;
  lastUpdated: string;
  observedAt: string;
  sourceHash: string;
}>;

/** Compact question snapshot. Buyer text and identity are deliberately excluded. */
export type MercadoLibreQuestionSnapshot = Readonly<{
  organizationId: string;
  accountId: string;
  sellerId: string;
  questionId: string;
  itemId: string;
  status: string;
  dateCreated: string;
  hasAnswer: boolean;
  hold: boolean;
  suspectedSpam: boolean;
  observedAt: string;
  sourceHash: string;
}>;

/** Compact commercial snapshot. Buyer, contact, billing and address data are excluded. */
export type MercadoLibreOrderSnapshot = Readonly<{
  organizationId: string;
  accountId: string;
  sellerId: string;
  orderId: string;
  status: string;
  dateCreated: string;
  dateClosed?: string;
  lastUpdated: string;
  currencyId: string;
  totalAmountMinor: number;
  paidAmountMinor?: number;
  itemCount: number;
  unitCount: number;
  itemIds: readonly string[];
  packId?: string;
  shippingId?: string;
  tags: readonly string[];
  observedAt: string;
  sourceHash: string;
}>;

export type MercadoLibreReputationSnapshot = Readonly<{
  organizationId: string;
  accountId: string;
  sellerId: string;
  siteId: typeof MERCADOLIBRE_CHILE_SITE_ID;
  levelId?: string;
  powerSellerStatus?: string;
  period: string;
  totalTransactions: number;
  completedTransactions: number;
  canceledTransactions: number;
  positiveRating: number;
  neutralRating: number;
  negativeRating: number;
  observedAt: string;
  sourceHash: string;
}>;

export class MercadoLibreIntegrationError extends Error {
  constructor(
    readonly code:
      | "mercadolibre-disabled"
      | "mercadolibre-not-connected"
      | "mercadolibre-invalid-state"
      | "mercadolibre-site-mismatch"
      | "mercadolibre-seller-mismatch"
      | "mercadolibre-refresh-in-progress"
      | "mercadolibre-reauthorization-required"
      | "mercadolibre-taxonomy-unavailable",
    message: string,
  ) {
    super(message);
    this.name = "MercadoLibreIntegrationError";
  }
}

export class MercadoLibreWriteBlockedError extends Error {
  readonly code = "mercadolibre-write-blocked";

  constructor(
    readonly operation: string,
    readonly sellerId?: string,
  ) {
    super(
      `MercadoLibre write operations are blocked. Attempted: ${operation}${
        sellerId ? ` for seller ${sellerId}` : ""
      }.`,
    );
    this.name = "MercadoLibreWriteBlockedError";
  }
}

export type MercadoLibreQuestionAnswerWriteGrant = Readonly<{
  action: "question.answer";
  policyVersion: string;
}>;

/**
 * Fail-closed boundary inherited from MSL. There is intentionally no feature
 * flag until each mutation has its own policy, receipt and live smoke test.
 */
export function assertMercadoLibreWriteDisabled(operation: string, sellerId?: string): never {
  throw new MercadoLibreWriteBlockedError(operation, sellerId);
}

/**
 * The only scoped write exception currently modeled by the domain. Callers
 * must still enforce the exact account, policy, approval and receipt chain.
 */
export function assertMercadoLibreWriteAllowed(
  operation: ActionKind,
  grant: MercadoLibreQuestionAnswerWriteGrant | null,
  sellerId?: string,
): void {
  if (
    operation !== "question.answer" ||
    grant?.action !== "question.answer" ||
    grant.policyVersion.trim().length === 0
  ) {
    assertMercadoLibreWriteDisabled(operation, sellerId);
  }
}
