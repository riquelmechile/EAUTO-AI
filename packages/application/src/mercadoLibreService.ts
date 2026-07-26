import {
  MERCADOLIBRE_CHILE_SITE_ID,
  MercadoLibreIntegrationError,
  type MercadoLibreClaimSnapshot,
  type MercadoLibreConnection,
  type MercadoLibreListingSnapshot,
  type MercadoLibreQuestionSnapshot,
} from "@eauto/domain";

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

  private async ensureAccessToken(input: {
    organizationId: string;
    accountId: string;
  }): Promise<string> {
    let stored = await this.requireConnection(input);
    if (stored.connection.status === "reauthorization-required") {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-reauthorization-required",
        `MercadoLibre account ${input.accountId} requires authorization again.`,
      );
    }
    const now = this.clock.now();
    if (
      new Date(stored.connection.expiresAt).getTime() >
      now.getTime() + this.config.refreshWindowMs
    ) {
      return this.revealAccessToken(stored);
    }

    const leaseOwner = this.security.randomId("meli-refresh");
    const acquired = await this.connections.acquireRefreshLease({
      accountId: input.accountId,
      owner: leaseOwner,
      now,
      leaseUntil: new Date(now.getTime() + this.config.refreshLeaseMs),
    });
    if (!acquired) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-refresh-in-progress",
        `Another worker is refreshing MercadoLibre account ${input.accountId}.`,
      );
    }

    try {
      stored = await this.requireConnection(input);
      const currentTime = this.clock.now();
      if (
        new Date(stored.connection.expiresAt).getTime() >
        currentTime.getTime() + this.config.refreshWindowMs
      ) {
        return this.revealAccessToken(stored);
      }
      const context = credentialContext(stored.connection.accountId, stored.connection.sellerId);
      const refreshToken = this.security.reveal(stored.protectedRefreshToken, `${context}:refresh`);
      const tokens = await this.client.refreshAccessToken(refreshToken);
      if (tokens.userId !== undefined && tokens.userId !== stored.connection.sellerId) {
        throw new MercadoLibreIntegrationError(
          "mercadolibre-seller-mismatch",
          `Refreshed token belongs to seller ${tokens.userId}, expected ${stored.connection.sellerId}.`,
        );
      }
      const refreshedConnection = Object.freeze({
        ...stored.connection,
        scopes: tokens.scopes,
        status: "active" as const,
        expiresAt: new Date(currentTime.getTime() + tokens.expiresInSeconds * 1000).toISOString(),
        updatedAt: currentTime.toISOString(),
      });
      const refreshed = this.protectCredential(
        refreshedConnection,
        tokens.accessToken,
        tokens.refreshToken,
        tokens.tokenType,
      );
      await this.connections.save(refreshed);
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof MercadoLibreRemoteError && error.reauthorizationRequired) {
        await this.connections.markReauthorizationRequired(input.accountId, this.clock.now());
        throw new MercadoLibreIntegrationError(
          "mercadolibre-reauthorization-required",
          `MercadoLibre rejected the refresh token for ${input.accountId}.`,
        );
      }
      throw error;
    } finally {
      await this.connections.releaseRefreshLease(input.accountId, leaseOwner);
    }
  }

  private expectedSellerId(accountId: string): string {
    const sellerId = this.config.expectedSellerIds[accountId]?.trim();
    if (!sellerId) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-seller-mismatch",
        `No expected MercadoLibre Chile seller ID is configured for account ${accountId}.`,
      );
    }
    return sellerId;
  }

  private assertChileIdentity(accountId: string, user: MercadoLibreRemoteUser): void {
    if (user.siteId !== MERCADOLIBRE_CHILE_SITE_ID) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-site-mismatch",
        `MercadoLibre account ${user.id} belongs to ${user.siteId}, expected MLC (Chile).`,
      );
    }
    const expectedSellerId = this.expectedSellerId(accountId);
    if (user.id !== expectedSellerId) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-seller-mismatch",
        `MercadoLibre account mismatch for ${accountId}: expected ${expectedSellerId}, received ${user.id}.`,
      );
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
        `MercadoLibre account ${input.accountId} is not connected.`,
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
    const context = credentialContext(connection.accountId, connection.sellerId);
    return Object.freeze({
      connection,
      protectedAccessToken: this.security.protect(accessToken, `${context}:access`),
      protectedRefreshToken: this.security.protect(refreshToken, `${context}:refresh`),
      tokenType,
    });
  }

  private revealAccessToken(record: MercadoLibreCredentialRecord): string {
    return this.security.reveal(
      record.protectedAccessToken,
      `${credentialContext(record.connection.accountId, record.connection.sellerId)}:access`,
    );
  }
}

function connectionFrom(input: {
  organizationId: string;
  accountId: string;
  user: MercadoLibreRemoteUser;
  tokens: MercadoLibreTokenSet;
  now: Date;
}): MercadoLibreConnection {
  return Object.freeze({
    organizationId: input.organizationId,
    accountId: input.accountId,
    sellerId: input.user.id,
    ...(input.user.nickname ? { nickname: input.user.nickname } : {}),
    siteId: MERCADOLIBRE_CHILE_SITE_ID,
    scopes: input.tokens.scopes,
    status: "active",
    expiresAt: new Date(input.now.getTime() + input.tokens.expiresInSeconds * 1000).toISOString(),
    updatedAt: input.now.toISOString(),
  });
}

function stateContext(accountId: string, stateHash: string): string {
  return `mercadolibre:oauth-state:${accountId}:${stateHash}`;
}

function credentialContext(accountId: string, sellerId: string): string {
  return `mercadolibre:credential:${accountId}:${sellerId}`;
}
