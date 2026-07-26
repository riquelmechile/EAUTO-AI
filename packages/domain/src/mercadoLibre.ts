export type MercadoLibreConnectionStatus = "connected" | "error" | "disconnected";

export type MercadoLibreConnection = Readonly<{
  accountId: string;
  organizationId: string;
  mercadoLibreUserId: number;
  siteId: string;
  nickname: string;
  status: MercadoLibreConnectionStatus;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  accessExpiresAt: string;
  tokenVersion: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type MercadoLibreOAuthState = Readonly<{
  stateHash: string;
  organizationId: string;
  accountId: string;
  actorId: string;
  codeVerifierCiphertext: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}>;

export type MercadoLibreListingSnapshot = Readonly<{
  accountId: string;
  organizationId: string;
  mercadoLibreUserId: number;
  itemIds: readonly string[];
  total: number;
  syncedAt: string;
  source: "mercadolibre-users-items-search";
}>;

export type MercadoLibreUserProfile = Readonly<{
  id: number;
  nickname: string;
  siteId: string;
  countryId: string | null;
}>;

export class MercadoLibreIntegrationError extends Error {
  readonly code = "mercadolibre-integration-error";

  constructor(message: string) {
    super(message);
    this.name = "MercadoLibreIntegrationError";
  }
}

export class MercadoLibreOAuthStateError extends Error {
  readonly code = "invalid-oauth-state";

  constructor(message = "The Mercado Libre authorization state is invalid or expired.") {
    super(message);
    this.name = "MercadoLibreOAuthStateError";
  }
}

export class MercadoLibreRefreshBusyError extends Error {
  readonly code = "mercadolibre-refresh-busy";

  constructor(message = "Mercado Libre token refresh is already in progress.") {
    super(message);
    this.name = "MercadoLibreRefreshBusyError";
  }
}

export function assertMercadoLibreChileProfile(profile: MercadoLibreUserProfile): void {
  if (profile.siteId !== "MLC") {
    throw new MercadoLibreIntegrationError(
      `Expected a Mercado Libre Chile account (MLC), received ${profile.siteId}.`,
    );
  }
}
