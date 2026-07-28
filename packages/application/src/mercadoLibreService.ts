import {
  MERCADOLIBRE_CHILE_SITE_ID,
  MercadoLibreIntegrationError,
  type MercadoLibreClaimSnapshot,
  type MercadoLibreConnection,
  type MercadoLibreListingSnapshot,
  type MercadoLibreOrderSnapshot,
  type MercadoLibreQuestionSnapshot,
  type MercadoLibreReputationSnapshot,
} from "@eauto/domain";
import type {
  MercadoLibreItemValidationClientPort,
  MercadoLibreItemValidationDraft,
  MercadoLibreItemValidationResult,
  MercadoLibreRemoteItemValidationResult,
} from "./mercadoLibreItemValidation.js";

export type MercadoLibreOAuthStateRecord = Readonly<{
  stateHash: string;
  organizationId: string;
  accountId: string;
  protectedVerifier: string;
  expiresAt: string;
  createdAt: string;
}>;

export type MercadoLibreCredentialRecord = Readonly<{
  connection: MercadoLibreConnection;
  protectedAccessToken: string;
  protectedRefreshToken: string;
  tokenType: string;
  refreshLeaseOwner?: string;
  refreshLeaseUntil?: string;
}>;

export type MercadoLibreTokenSet = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  tokenType: string;
  scopes: readonly string[];
  userId?: string;
}>;

export type MercadoLibreRemoteUser = Readonly<{
  id: string;
  nickname?: string;
  siteId: string;
}>;

export type MercadoLibreRemoteListing = Readonly<{
  itemId: string;
  title: string;
  status: string;
  priceMinor: number;
  currencyId: string;
  availableQuantity: number;
  soldQuantity: number;
  permalink?: string;
  sourceHash: string;
}>;

export type MercadoLibreRemoteClaim = Readonly<{
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
  sourceHash: string;
}>;

export type MercadoLibreRemoteQuestion = Readonly<{
  questionId: string;
  itemId: string;
  status: string;
  dateCreated: string;
  hasAnswer: boolean;
  hold: boolean;
  suspectedSpam: boolean;
  sourceHash: string;
}>;

export type MercadoLibreRemoteOrder = Readonly<{
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
  sourceHash: string;
}>;

export type MercadoLibreRemoteReputation = Readonly<{
  sellerId: string;
  siteId: string;
  levelId?: string;
  powerSellerStatus?: string;
  period: string;
  totalTransactions: number;
  completedTransactions: number;
  canceledTransactions: number;
  positiveRating: number;
  neutralRating: number;
  negativeRating: number;
  sourceHash: string;
}>;

export interface MercadoLibreOAuthStateRepository {
  create(record: MercadoLibreOAuthStateRecord): Promise<void>;
  consume(stateHash: string, now: Date): Promise<MercadoLibreOAuthStateRecord | null>;
}

export interface MercadoLibreConnectionRepository {
  get(accountId: string): Promise<MercadoLibreCredentialRecord | null>;
  save(record: MercadoLibreCredentialRecord): Promise<void>;
  acquireRefreshLease(input: {
    accountId: string;
    owner: string;
    now: Date;
    leaseUntil: Date;
  }): Promise<boolean>;
  releaseRefreshLease(accountId: string, owner: string): Promise<void>;
  markReauthorizationRequired(accountId: string, now: Date): Promise<void>;
  replaceListingSnapshots(
    accountId: string,
    snapshots: readonly MercadoLibreListingSnapshot[],
  ): Promise<void>;
  listListingSnapshots(accountId: string): Promise<readonly MercadoLibreListingSnapshot[]>;
  replaceClaimSnapshots(
    accountId: string,
    snapshots: readonly MercadoLibreClaimSnapshot[],
  ): Promise<void>;
  listClaimSnapshots(accountId: string): Promise<readonly MercadoLibreClaimSnapshot[]>;
  replaceQuestionSnapshots(
    accountId: string,
    snapshots: readonly MercadoLibreQuestionSnapshot[],
  ): Promise<void>;
  listQuestionSnapshots(accountId: string): Promise<readonly MercadoLibreQuestionSnapshot[]>;
  replaceOrderSnapshots(
    accountId: string,
    snapshots: readonly MercadoLibreOrderSnapshot[],
  ): Promise<void>;
  listOrderSnapshots(accountId: string): Promise<readonly MercadoLibreOrderSnapshot[]>;
  saveReputationSnapshot(snapshot: MercadoLibreReputationSnapshot): Promise<void>;
  getReputationSnapshot(accountId: string): Promise<MercadoLibreReputationSnapshot | null>;
}

export interface MercadoLibreSecurityPort {
  createAuthorizationSecrets(): Readonly<{
    state: string;
    stateHash: string;
    verifier: string;
    challenge: string;
  }>;
  hash(value: string): string;
  randomId(prefix: string): string;
  protect(value: string, context: string): string;
  reveal(protectedValue: string, context: string): string;
}

export interface MercadoLibreClientPort {
  exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<MercadoLibreTokenSet>;
  refreshAccessToken(refreshToken: string): Promise<MercadoLibreTokenSet>;
  getCurrentUser(accessToken: string): Promise<MercadoLibreRemoteUser>;
  listSellerListings(
    sellerId: string,
    accessToken: string,
  ): Promise<readonly MercadoLibreRemoteListing[]>;
  searchSellerClaims(
    sellerId: string,
    accessToken: string,
  ): Promise<readonly MercadoLibreRemoteClaim[]>;
  searchSellerQuestions(
    sellerId: string,
    accessToken: string,
  ): Promise<readonly MercadoLibreRemoteQuestion[]>;
  searchSellerOrders(
    sellerId: string,
    accessToken: string,
  ): Promise<readonly MercadoLibreRemoteOrder[]>;
  getSellerReputation(sellerId: string, accessToken: string): Promise<MercadoLibreRemoteReputation>;
}

export class MercadoLibreRemoteError extends Error {
  constructor(
    message: string,
    readonly reauthorizationRequired = false,
  ) {
    super(message);
    this.name = "MercadoLibreRemoteError";
  }
}

export type MercadoLibreServiceConfig = Readonly<{
  clientId: string;
  redirectUri: string;
  authorizationUrl: string;
  expectedSellerIds: Readonly<Record<string, string>>;
  stateTtlMs: number;
  refreshWindowMs: number;
  refreshLeaseMs: number;
}>;

export class MercadoLibreService {
  constructor(
    private readonly states: MercadoLibreOAuthStateRepository,
    private readonly connections: MercadoLibreConnectionRepository,
    private readonly security: MercadoLibreSecurityPort,
    private readonly client: MercadoLibreClientPort,
    private readonly clock: { now(): Date },
    private readonly config: MercadoLibreServiceConfig,
    private readonly itemValidationClient: MercadoLibreItemValidationClientPort | null = null,
  ) {}

  async beginAuthorization(input: {
    organizationId: string;
    accountId: string;
  }): Promise<{ authorizationUrl: string; expiresAt: string }> {
    this.expectedSellerId(input.accountId);
    const secrets = this.security.createAuthorizationSecrets();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.config.stateTtlMs);
    const context = stateContext(input.accountId, secrets.stateHash);
    await this.states.create(
      Object.freeze({
        stateHash: secrets.stateHash,
        organizationId: input.organizationId,
        accountId: input.accountId,
        protectedVerifier: this.security.protect(secrets.verifier, context),
        expiresAt: expiresAt.toISOString(),
        createdAt: now.toISOString(),
      }),
    );

    const url = new URL(this.config.authorizationUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("state", secrets.state);
    url.searchParams.set("code_challenge", secrets.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { authorizationUrl: url.toString(), expiresAt: expiresAt.toISOString() };
  }

  async completeAuthorization(input: {
    state: string;
    code: string;
  }): Promise<MercadoLibreConnection> {
    const stateHash = this.security.hash(input.state);
    const state = await this.states.consume(stateHash, this.clock.now());
    if (!state) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-invalid-state",
        "MercadoLibre OAuth state is invalid, expired or already consumed.",
      );
    }

    const verifier = this.security.reveal(
      state.protectedVerifier,
      stateContext(state.accountId, stateHash),
    );
    const tokens = await this.client.exchangeAuthorizationCode({
      code: input.code,
      codeVerifier: verifier,
    });
    const user = await this.client.getCurrentUser(tokens.accessToken);
    this.assertChileIdentity(state.accountId, user);
    if (tokens.userId !== undefined && tokens.userId !== user.id) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-seller-mismatch",
        `MercadoLibre token user ${tokens.userId} does not match /users/me ${user.id}.`,
      );
    }

    const now = this.clock.now();
    const connection = connectionFrom({
      organizationId: state.organizationId,
      accountId: state.accountId,
      user,
      tokens,
      now,
    });
    await this.connections.save(
      this.protectCredential(connection, tokens.accessToken, tokens.refreshToken, tokens.tokenType),
    );
    return connection;
  }

  async getConnection(input: {
    organizationId: string;
    accountId: string;
  }): Promise<MercadoLibreConnection | null> {
    const record = await this.connections.get(input.accountId);
    if (!record || record.connection.organizationId !== input.organizationId) return null;
    return record.connection;
  }

  async validateItemDraft(input: {
    organizationId: string;
    accountId: string;
    draft: MercadoLibreItemValidationDraft;
  }): Promise<MercadoLibreItemValidationResult> {
    if (!this.itemValidationClient) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-item-validation-unavailable",
        "MercadoLibre item validation is not configured.",
      );
    }
    assertItemValidationDraft(input.draft);
    const accessToken = await this.ensureAccessToken(input);
    const stored = await this.requireConnection(input);
    try {
      const validation = await this.itemValidationClient.validateItemDraft(input.draft, accessToken);
      assertRemoteItemValidation(validation);
      return Object.freeze({
        ...validation,
        sellerId: stored.connection.sellerId,
        observedAt: this.clock.now().toISOString(),
      });
    } catch (error) {
      if (error instanceof MercadoLibreRemoteError && error.reauthorizationRequired) {
        await this.connections.markReauthorizationRequired(input.accountId, this.clock.now());
        throw new MercadoLibreIntegrationError(
          "mercadolibre-reauthorization-required",
          "MercadoLibre rejected the item validation token; reconnect the account.",
        );
      }
      throw error;
    }
  }

  async syncReadModel(input: { organizationId: string; accountId: string }): Promise<{
    connection: MercadoLibreConnection;
    listings: readonly MercadoLibreListingSnapshot[];
  }> {
    const accessToken = await this.ensureAccessToken(input);
    const stored = await this.requireConnection(input);
    const observedAt = this.clock.now();
    const remote = await this.client.listSellerListings(stored.connection.sellerId, accessToken);
    const listings = remote.map((item) =>
      Object.freeze({
        organizationId: input.organizationId,
        accountId: input.accountId,
        sellerId: stored.connection.sellerId,
        ...item,
        observedAt: observedAt.toISOString(),
      }),
    );
    await this.connections.replaceListingSnapshots(input.accountId, listings);
    const updatedConnection = Object.freeze({
      ...stored.connection,
      lastSyncedAt: observedAt.toISOString(),
      updatedAt: observedAt.toISOString(),
    });
    await this.connections.save(Object.freeze({ ...stored, connection: updatedConnection }));
    return { connection: updatedConnection, listings };
  }

  async syncCustomerOperations(input: { organizationId: string; accountId: string }): Promise<{
    claims: readonly MercadoLibreClaimSnapshot[];
    questions: readonly MercadoLibreQuestionSnapshot[];
    observedAt: string;
  }> {
    const accessToken = await this.ensureAccessToken(input);
    const stored = await this.requireConnection(input);
    const observedAt = this.clock.now().toISOString();
    const [remoteClaims, remoteQuestions] = await Promise.all([
      this.client.searchSellerClaims(stored.connection.sellerId, accessToken),
      this.client.searchSellerQuestions(stored.connection.sellerId, accessToken),
    ]);
    const claims = remoteClaims.map((claim) =>
      Object.freeze({
        organizationId: input.organizationId,
        accountId: input.accountId,
        sellerId: stored.connection.sellerId,
        ...claim,
        observedAt,
      }),
    );
    const questions = remoteQuestions.map((question) =>
      Object.freeze({
        organizationId: input.organizationId,
        accountId: input.accountId,
        sellerId: stored.connection.sellerId,
        ...question,
        observedAt,
      }),
    );
    await Promise.all([
      this.connections.replaceClaimSnapshots(input.accountId, claims),
      this.connections.replaceQuestionSnapshots(input.accountId, questions),
    ]);
    return { claims, questions, observedAt };
  }

  async syncCommercialOperations(input: { organizationId: string; accountId: string }): Promise<{
    orders: readonly MercadoLibreOrderSnapshot[];
    reputation: MercadoLibreReputationSnapshot;
    observedAt: string;
  }> {
    const accessToken = await this.ensureAccessToken(input);
    const stored = await this.requireConnection(input);
    const observedAt = this.clock.now().toISOString();
    const [remoteOrders, remoteReputation] = await Promise.all([
      this.client.searchSellerOrders(stored.connection.sellerId, accessToken),
      this.client.getSellerReputation(stored.connection.sellerId, accessToken),
    ]);
    if (
      remoteReputation.sellerId !== stored.connection.sellerId ||
      remoteReputation.siteId !== MERCADOLIBRE_CHILE_SITE_ID
    ) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-seller-mismatch",
        "MercadoLibre reputation identity does not match the connected Chile seller.",
      );
    }
    const orders = remoteOrders.map((order) =>
      Object.freeze({
        organizationId: input.organizationId,
        accountId: input.accountId,
        sellerId: stored.connection.sellerId,
        ...order,
        observedAt,
      }),
    );
    const reputation = Object.freeze({
      organizationId: input.organizationId,
      accountId: input.accountId,
      ...remoteReputation,
      siteId: MERCADOLIBRE_CHILE_SITE_ID,
      observedAt,
    });
    await Promise.all([
      this.connections.replaceOrderSnapshots(input.accountId, orders),
      this.connections.saveReputationSnapshot(reputation),
    ]);
    return { orders, reputation, observedAt };
  }

  async listListingSnapshots(input: {
    organizationId: string;
    accountId: string;
  }): Promise<readonly MercadoLibreListingSnapshot[]> {
    await this.requireConnection(input);
    return this.connections.listListingSnapshots(input.accountId);
  }

  async listClaimSnapshots(input: {
    organizationId: string;
    accountId: string;
  }): Promise<readonly MercadoLibreClaimSnapshot[]> {
    await this.requireConnection(input);
    return this.connections.listClaimSnapshots(input.accountId);
  }

  async listQuestionSnapshots(input: {
    organizationId: string;
    accountId: string;
  }): Promise<readonly MercadoLibreQuestionSnapshot[]> {
    await this.requireConnection(input);
    return this.connections.listQuestionSnapshots(input.accountId);
  }

  async listOrderSnapshots(input: {
    organizationId: string;
    accountId: string;
  }): Promise<readonly MercadoLibreOrderSnapshot[]> {
    await this.requireConnection(input);
    return this.connections.listOrderSnapshots(input.accountId);
  }

  async getReputationSnapshot(input: {
    organizationId: string;
    accountId: string;
  }): Promise<MercadoLibreReputationSnapshot | null> {
    await this.requireConnection(input);
    return this.connections.getReputationSnapshot(input.accountId);
  }

  private async ensureAccessToken(input: {
    organizationId: string;
    accountId: string;
  }): Promise<string> {
    let stored = await this.requireConnection(input);
    if (stored.connection.status === "reauthorization-required" || stored.connection.status === "revoked") {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-reauthorization-required",
        "MercadoLibre account must be reauthorized.",
      );
    }
    const now = this.clock.now();
    const expiresAt = new Date(stored.connection.expiresAt);
    if (expiresAt.getTime() - now.getTime() > this.config.refreshWindowMs) {
      return this.security.reveal(
        stored.protectedAccessToken,
        credentialContext(input.accountId, "access"),
      );
    }

    const owner = this.security.randomId("meli-refresh");
    const acquired = await this.connections.acquireRefreshLease({
      accountId: input.accountId,
      owner,
      now,
      leaseUntil: new Date(now.getTime() + this.config.refreshLeaseMs),
    });
    if (!acquired) {
      stored = await this.requireConnection(input);
      const refreshedExpiry = new Date(stored.connection.expiresAt);
      if (refreshedExpiry.getTime() - now.getTime() > this.config.refreshWindowMs) {
        return this.security.reveal(
          stored.protectedAccessToken,
          credentialContext(input.accountId, "access"),
        );
      }
      throw new MercadoLibreIntegrationError(
        "mercadolibre-refresh-in-progress",
        "Another worker is refreshing the MercadoLibre access token.",
      );
    }

    try {
      const refreshToken = this.security.reveal(
        stored.protectedRefreshToken,
        credentialContext(input.accountId, "refresh"),
      );
      const tokens = await this.client.refreshAccessToken(refreshToken);
      const user = await this.client.getCurrentUser(tokens.accessToken);
      this.assertChileIdentity(input.accountId, user);
      if (tokens.userId !== undefined && tokens.userId !== user.id) {
        throw new MercadoLibreIntegrationError(
          "mercadolibre-seller-mismatch",
          `MercadoLibre refreshed token user ${tokens.userId} does not match /users/me ${user.id}.`,
        );
      }
      const refreshedAt = this.clock.now();
      const connection = connectionFrom({
        organizationId: stored.connection.organizationId,
        accountId: input.accountId,
        user,
        tokens,
        now: refreshedAt,
        lastSyncedAt: stored.connection.lastSyncedAt,
      });
      await this.connections.save(
        this.protectCredential(
          connection,
          tokens.accessToken,
          tokens.refreshToken,
          tokens.tokenType,
        ),
      );
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof MercadoLibreRemoteError && error.reauthorizationRequired) {
        await this.connections.markReauthorizationRequired(input.accountId, this.clock.now());
        throw new MercadoLibreIntegrationError(
          "mercadolibre-reauthorization-required",
          "MercadoLibre rejected the refresh token; reconnect the account.",
        );
      }
      throw error;
    } finally {
      await this.connections.releaseRefreshLease(input.accountId, owner);
    }
  }

  private async requireConnection(input: {
    organizationId: string;
    accountId: string;
  }): Promise<MercadoLibreCredentialRecord> {
    const record = await this.connections.get(input.accountId);
    if (!record || record.connection.organizationId !== input.organizationId) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-not-connected",
        "MercadoLibre account is not connected for this organization.",
      );
    }
    return record;
  }

  private protectCredential(
    connection: MercadoLibreConnection,
    accessToken: string,
    refreshToken: string,
    tokenType: string,
  ): MercadoLibreCredentialRecord {
    return Object.freeze({
      connection,
      protectedAccessToken: this.security.protect(
        accessToken,
        credentialContext(connection.accountId, "access"),
      ),
      protectedRefreshToken: this.security.protect(
        refreshToken,
        credentialContext(connection.accountId, "refresh"),
      ),
      tokenType,
    });
  }

  private assertChileIdentity(accountId: string, user: MercadoLibreRemoteUser): void {
    if (user.siteId !== MERCADOLIBRE_CHILE_SITE_ID) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-site-mismatch",
        `Expected MercadoLibre Chile (${MERCADOLIBRE_CHILE_SITE_ID}) but received ${user.siteId}.`,
      );
    }
    const expectedSellerId = this.expectedSellerId(accountId);
    if (user.id !== expectedSellerId) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-seller-mismatch",
        `Expected seller ${expectedSellerId} for account ${accountId} but received ${user.id}.`,
      );
    }
  }

  private expectedSellerId(accountId: string): string {
    const sellerId = this.config.expectedSellerIds[accountId];
    if (!sellerId) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-disabled",
        `MercadoLibre seller mapping is not configured for account ${accountId}.`,
      );
    }
    return sellerId;
  }
}

function stateContext(accountId: string, stateHash: string): string {
  return `mercadolibre:state:${accountId}:${stateHash}`;
}

function credentialContext(accountId: string, kind: "access" | "refresh"): string {
  return `mercadolibre:credential:${accountId}:${kind}`;
}

function connectionFrom(input: {
  organizationId: string;
  accountId: string;
  user: MercadoLibreRemoteUser;
  tokens: MercadoLibreTokenSet;
  now: Date;
  lastSyncedAt?: string;
}): MercadoLibreConnection {
  return Object.freeze({
    organizationId: input.organizationId,
    accountId: input.accountId,
    sellerId: input.user.id,
    ...(input.user.nickname === undefined ? {} : { nickname: input.user.nickname }),
    siteId: MERCADOLIBRE_CHILE_SITE_ID,
    scopes: Object.freeze([...input.tokens.scopes]),
    status: "active",
    expiresAt: new Date(input.now.getTime() + input.tokens.expiresInSeconds * 1_000).toISOString(),
    ...(input.lastSyncedAt === undefined ? {} : { lastSyncedAt: input.lastSyncedAt }),
    updatedAt: input.now.toISOString(),
  });
}

function assertItemValidationDraft(draft: MercadoLibreItemValidationDraft): void {
  if (!/^MLC\d+$/.test(draft.categoryId)) {
    throw new Error("MercadoLibre item validation categoryId must identify a Chile category.");
  }
  if (draft.currencyId !== "CLP" || draft.buyingMode !== "buy_it_now") {
    throw new Error("MercadoLibre item validation currency and buying mode are server-owned.");
  }
  if (draft.shipping.mode !== "me2") {
    throw new Error("MercadoLibre item validation shipping mode must be me2.");
  }
}

function assertRemoteItemValidation(result: MercadoLibreRemoteItemValidationResult): void {
  if (result.status !== "valid" && result.status !== "invalid") {
    throw new Error("MercadoLibre item validation status is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(result.sourceHash)) {
    throw new Error("MercadoLibre item validation sourceHash must be a SHA-256 digest.");
  }
  if (result.status === "valid" && result.causes.length > 0) {
    throw new Error("MercadoLibre valid item validation cannot include causes.");
  }
}
