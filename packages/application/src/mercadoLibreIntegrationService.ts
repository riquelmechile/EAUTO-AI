import {
  MercadoLibreIntegrationError,
  MercadoLibreOAuthStateError,
  MercadoLibreRefreshBusyError,
  assertMercadoLibreChileProfile,
  type ActorIdentity,
  type MercadoLibreConnection,
  type MercadoLibreListingSnapshot,
  type MercadoLibreOAuthState,
  type MercadoLibreUserProfile,
} from "@eauto/domain";
import type { Clock, IdGenerator } from "./ports.js";

export type MercadoLibreTokenResponse = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  userId: number;
  scope: string | null;
}>;

export type MercadoLibreOAuthStateRepository = {
  save(state: MercadoLibreOAuthState): Promise<void>;
  consume(stateHash: string, consumedAt: string): Promise<MercadoLibreOAuthState | null>;
};

export type MercadoLibreConnectionRepository = {
  save(connection: MercadoLibreConnection): Promise<void>;
  get(accountId: string): Promise<MercadoLibreConnection | null>;
  claimRefresh(input: {
    accountId: string;
    workerId: string;
    now: string;
    lockedUntil: string;
  }): Promise<boolean>;
  saveRefreshed(input: {
    connection: MercadoLibreConnection;
    workerId: string;
    expectedTokenVersion: number;
  }): Promise<boolean>;
  releaseRefresh(input: { accountId: string; workerId: string; lastError: string }): Promise<void>;
};

export type MercadoLibreListingSnapshotRepository = {
  save(snapshot: MercadoLibreListingSnapshot): Promise<void>;
  get(accountId: string): Promise<MercadoLibreListingSnapshot | null>;
};

export type SecretVault = {
  seal(plaintext: string, associatedData: string): string;
  open(ciphertext: string, associatedData: string): string;
};

export type PkcePort = {
  create(): Readonly<{
    state: string;
    stateHash: string;
    codeVerifier: string;
    codeChallenge: string;
  }>;
};

export type MercadoLibreApiPort = {
  buildAuthorizationUrl(input: {
    state: string;
    codeChallenge: string;
  }): string;
  exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<MercadoLibreTokenResponse>;
  refreshAccessToken(refreshToken: string): Promise<MercadoLibreTokenResponse>;
  getCurrentUser(accessToken: string): Promise<MercadoLibreUserProfile>;
  listSellerItemIds(input: {
    accessToken: string;
    userId: number;
  }): Promise<readonly string[]>;
};

export type MercadoLibreConnectionView = Readonly<{
  accountId: string;
  organizationId: string;
  mercadoLibreUserId: number;
  siteId: string;
  nickname: string;
  status: MercadoLibreConnection["status"];
  accessExpiresAt: string;
  tokenVersion: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}>;

export class MercadoLibreIntegrationService {
  constructor(
    private readonly states: MercadoLibreOAuthStateRepository,
    private readonly connections: MercadoLibreConnectionRepository,
    private readonly snapshots: MercadoLibreListingSnapshotRepository,
    private readonly vault: SecretVault,
    private readonly pkce: PkcePort,
    private readonly api: MercadoLibreApiPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly policy: Readonly<{
      stateTtlMs: number;
      refreshLeaseMs: number;
      refreshBeforeExpiryMs: number;
    }>,
  ) {}

  async startAuthorization(input: {
    actor: ActorIdentity;
    accountId: string;
  }): Promise<Readonly<{ authorizationUrl: string; expiresAt: string }>> {
    const generated = this.pkce.create();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.policy.stateTtlMs).toISOString();
    const associatedData = oauthVerifierAssociatedData(input.accountId, generated.stateHash);
    await this.states.save(
      Object.freeze({
        stateHash: generated.stateHash,
        organizationId: input.actor.organizationId,
        accountId: input.accountId,
        actorId: input.actor.id,
        codeVerifierCiphertext: this.vault.seal(generated.codeVerifier, associatedData),
        expiresAt,
        consumedAt: null,
        createdAt: now.toISOString(),
      }),
    );
    return Object.freeze({
      authorizationUrl: this.api.buildAuthorizationUrl({
        state: generated.state,
        codeChallenge: generated.codeChallenge,
      }),
      expiresAt,
    });
  }

  async completeAuthorization(input: {
    state: string;
    code: string;
  }): Promise<MercadoLibreConnectionView> {
    const stateHash = this.pkceHash(input.state);
    const now = this.clock.now();
    const savedState = await this.states.consume(stateHash, now.toISOString());
    if (!savedState || Date.parse(savedState.expiresAt) <= now.getTime()) {
      throw new MercadoLibreOAuthStateError();
    }

    const codeVerifier = this.vault.open(
      savedState.codeVerifierCiphertext,
      oauthVerifierAssociatedData(savedState.accountId, stateHash),
    );
    const tokens = await this.api.exchangeAuthorizationCode({
      code: input.code,
      codeVerifier,
    });
    const profile = await this.api.getCurrentUser(tokens.accessToken);
    assertMercadoLibreChileProfile(profile);
    if (tokens.userId !== profile.id) {
      throw new MercadoLibreIntegrationError("OAuth token user does not match /users/me.");
    }

    const connection = this.createConnection({
      organizationId: savedState.organizationId,
      accountId: savedState.accountId,
      profile,
      tokens,
      tokenVersion: 1,
      createdAt: now.toISOString(),
      lastSyncedAt: null,
    });
    await this.connections.save(connection);
    return toConnectionView(connection);
  }

  async getStatus(input: {
    organizationId: string;
    accountId: string;
  }): Promise<MercadoLibreConnectionView | null> {
    const connection = await this.connections.get(input.accountId);
    if (!connection || connection.organizationId !== input.organizationId) return null;
    return toConnectionView(connection);
  }

  async getSnapshot(input: {
    organizationId: string;
    accountId: string;
  }): Promise<MercadoLibreListingSnapshot | null> {
    const connection = await this.connections.get(input.accountId);
    if (!connection || connection.organizationId !== input.organizationId) return null;
    const snapshot = await this.snapshots.get(input.accountId);
    return snapshot?.organizationId === input.organizationId ? snapshot : null;
  }

  async syncReadOnly(input: {
    organizationId: string;
    accountId: string;
    workerId?: string;
  }): Promise<MercadoLibreListingSnapshot> {
    const connection = await this.requireConnection(input.organizationId, input.accountId);
    const accessToken = await this.validAccessToken(
      connection,
      input.workerId ?? this.ids.next("ml-refresh"),
    );
    const profile = await this.api.getCurrentUser(accessToken);
    assertMercadoLibreChileProfile(profile);
    if (profile.id !== connection.mercadoLibreUserId) {
      throw new MercadoLibreIntegrationError("Connected seller identity changed unexpectedly.");
    }
    const itemIds = Object.freeze([
      ...new Set(
        await this.api.listSellerItemIds({
          accessToken,
          userId: profile.id,
        }),
      ),
    ]);
    const syncedAt = this.clock.now().toISOString();
    const snapshot: MercadoLibreListingSnapshot = Object.freeze({
      accountId: connection.accountId,
      organizationId: connection.organizationId,
      mercadoLibreUserId: profile.id,
      itemIds,
      total: itemIds.length,
      syncedAt,
      source: "mercadolibre-users-items-search",
    });
    await this.snapshots.save(snapshot);
    await this.connections.save(
      Object.freeze({
        ...connection,
        nickname: profile.nickname,
        siteId: profile.siteId,
        status: "connected",
        lastSyncedAt: syncedAt,
        lastError: null,
        updatedAt: syncedAt,
      }),
    );
    return snapshot;
  }

  private async validAccessToken(
    connection: MercadoLibreConnection,
    workerId: string,
  ): Promise<string> {
    const now = this.clock.now();
    if (Date.parse(connection.accessExpiresAt) - now.getTime() > this.policy.refreshBeforeExpiryMs) {
      return this.vault.open(
        connection.accessTokenCiphertext,
        tokenAssociatedData(connection.accountId, "access", connection.tokenVersion),
      );
    }

    const claimed = await this.connections.claimRefresh({
      accountId: connection.accountId,
      workerId,
      now: now.toISOString(),
      lockedUntil: new Date(now.getTime() + this.policy.refreshLeaseMs).toISOString(),
    });
    if (!claimed) throw new MercadoLibreRefreshBusyError();

    try {
      const refreshToken = this.vault.open(
        connection.refreshTokenCiphertext,
        tokenAssociatedData(connection.accountId, "refresh", connection.tokenVersion),
      );
      const tokens = await this.api.refreshAccessToken(refreshToken);
      if (tokens.userId !== connection.mercadoLibreUserId) {
        throw new MercadoLibreIntegrationError("Refreshed token belongs to a different seller.");
      }
      const nextVersion = connection.tokenVersion + 1;
      const refreshed = this.createConnection({
        organizationId: connection.organizationId,
        accountId: connection.accountId,
        profile: {
          id: connection.mercadoLibreUserId,
          nickname: connection.nickname,
          siteId: connection.siteId,
          countryId: null,
        },
        tokens,
        tokenVersion: nextVersion,
        createdAt: connection.createdAt,
        lastSyncedAt: connection.lastSyncedAt,
      });
      const saved = await this.connections.saveRefreshed({
        connection: refreshed,
        workerId,
        expectedTokenVersion: connection.tokenVersion,
      });
      if (!saved) throw new MercadoLibreRefreshBusyError("Mercado Libre refresh lease was lost.");
      return tokens.accessToken;
    } catch (error) {
      await this.connections.releaseRefresh({
        accountId: connection.accountId,
        workerId,
        lastError: error instanceof Error ? error.message : "Unknown token refresh error",
      });
      throw error;
    }
  }

  private createConnection(input: {
    organizationId: string;
    accountId: string;
    profile: MercadoLibreUserProfile;
    tokens: MercadoLibreTokenResponse;
    tokenVersion: number;
    createdAt: string;
    lastSyncedAt: string | null;
  }): MercadoLibreConnection {
    const updatedAt = this.clock.now().toISOString();
    return Object.freeze({
      accountId: input.accountId,
      organizationId: input.organizationId,
      mercadoLibreUserId: input.profile.id,
      siteId: input.profile.siteId,
      nickname: input.profile.nickname,
      status: "connected",
      accessTokenCiphertext: this.vault.seal(
        input.tokens.accessToken,
        tokenAssociatedData(input.accountId, "access", input.tokenVersion),
      ),
      refreshTokenCiphertext: this.vault.seal(
        input.tokens.refreshToken,
        tokenAssociatedData(input.accountId, "refresh", input.tokenVersion),
      ),
      accessExpiresAt: new Date(
        this.clock.now().getTime() + input.tokens.expiresInSeconds * 1_000,
      ).toISOString(),
      tokenVersion: input.tokenVersion,
      lastSyncedAt: input.lastSyncedAt,
      lastError: null,
      createdAt: input.createdAt,
      updatedAt,
    });
  }

  private async requireConnection(
    organizationId: string,
    accountId: string,
  ): Promise<MercadoLibreConnection> {
    const connection = await this.connections.get(accountId);
    if (!connection || connection.organizationId !== organizationId) {
      throw new MercadoLibreIntegrationError("Mercado Libre account is not connected.");
    }
    return connection;
  }

  private pkceHash(state: string): string {
    const generated = this.pkce as PkcePort & { hashState?(value: string): string };
    if (!generated.hashState) {
      throw new MercadoLibreIntegrationError("PKCE adapter cannot validate OAuth state.");
    }
    return generated.hashState(state);
  }
}

function oauthVerifierAssociatedData(accountId: string, stateHash: string): string {
  return `mercadolibre:oauth:${accountId}:${stateHash}`;
}

function tokenAssociatedData(
  accountId: string,
  kind: "access" | "refresh",
  version: number,
): string {
  return `mercadolibre:token:${accountId}:${kind}:v${version}`;
}

function toConnectionView(connection: MercadoLibreConnection): MercadoLibreConnectionView {
  return Object.freeze({
    accountId: connection.accountId,
    organizationId: connection.organizationId,
    mercadoLibreUserId: connection.mercadoLibreUserId,
    siteId: connection.siteId,
    nickname: connection.nickname,
    status: connection.status,
    accessExpiresAt: connection.accessExpiresAt,
    tokenVersion: connection.tokenVersion,
    lastSyncedAt: connection.lastSyncedAt,
    lastError: connection.lastError,
    updatedAt: connection.updatedAt,
  });
}
