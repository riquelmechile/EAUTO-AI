import {
  MercadoLibreRemoteError,
  type MercadoLibreClientPort,
  type MercadoLibreConnectionRepository,
  type MercadoLibreCredentialRecord,
  type MercadoLibreSecurityPort,
} from "@eauto/application";
import { MercadoLibreIntegrationError } from "@eauto/domain";
import type {
  ForReadingMercadoLibreQuestionAnswerCredential,
  MercadoLibreQuestionAnswerCredential,
} from "./mercadoLibreQuestionAnswerExecutor.js";

export type MercadoLibreQuestionAnswerCredentialProviderConfig = Readonly<{
  allowedAccountId: string;
  refreshWindowMs: number;
  refreshLeaseMs: number;
}>;

export class RotatingMercadoLibreQuestionAnswerCredentialProvider
  implements ForReadingMercadoLibreQuestionAnswerCredential
{
  constructor(
    private readonly connections: MercadoLibreConnectionRepository,
    private readonly security: MercadoLibreSecurityPort,
    private readonly client: MercadoLibreClientPort,
    private readonly clock: { now(): Date },
    private readonly config: MercadoLibreQuestionAnswerCredentialProviderConfig,
  ) {
    if (!config.allowedAccountId.trim()) throw new Error("Allowed MercadoLibre account is required.");
    if (!Number.isSafeInteger(config.refreshWindowMs) || config.refreshWindowMs < 60_000) {
      throw new Error("MercadoLibre refresh window must be at least 60000 ms.");
    }
    if (!Number.isSafeInteger(config.refreshLeaseMs) || config.refreshLeaseMs < 5_000) {
      throw new Error("MercadoLibre refresh lease must be at least 5000 ms.");
    }
  }

  async get(accountId: string): Promise<MercadoLibreQuestionAnswerCredential> {
    if (accountId !== this.config.allowedAccountId) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-not-connected",
        `MercadoLibre question answers are not configured for account ${accountId}.`,
      );
    }
    let stored = await this.requireCredential(accountId);
    this.assertUsableStatus(stored);
    const now = this.clock.now();
    if (this.tokenRemainsValid(stored, now)) return this.revealCredential(stored);

    const leaseOwner = this.security.randomId("meli-question-refresh");
    const acquired = await this.connections.acquireRefreshLease({
      accountId,
      owner: leaseOwner,
      now,
      leaseUntil: new Date(now.getTime() + this.config.refreshLeaseMs),
    });
    if (!acquired) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-refresh-in-progress",
        `Another worker is refreshing MercadoLibre account ${accountId}.`,
      );
    }

    try {
      stored = await this.requireCredential(accountId);
      this.assertUsableStatus(stored);
      const currentTime = this.clock.now();
      if (this.tokenRemainsValid(stored, currentTime)) return this.revealCredential(stored);

      const context = credentialContext(stored.connection.accountId, stored.connection.sellerId);
      const refreshToken = this.security.reveal(stored.protectedRefreshToken, `${context}:refresh`);
      const tokens = await this.client.refreshAccessToken(refreshToken);
      if (tokens.userId !== undefined && tokens.userId !== stored.connection.sellerId) {
        throw new MercadoLibreIntegrationError(
          "mercadolibre-seller-mismatch",
          `Refreshed token belongs to seller ${tokens.userId}, expected ${stored.connection.sellerId}.`,
        );
      }
      const connection = Object.freeze({
        ...stored.connection,
        scopes: tokens.scopes,
        status: "active" as const,
        expiresAt: new Date(currentTime.getTime() + tokens.expiresInSeconds * 1_000).toISOString(),
        updatedAt: currentTime.toISOString(),
      });
      const refreshed: MercadoLibreCredentialRecord = Object.freeze({
        connection,
        protectedAccessToken: this.security.protect(tokens.accessToken, `${context}:access`),
        protectedRefreshToken: this.security.protect(tokens.refreshToken, `${context}:refresh`),
        tokenType: tokens.tokenType,
      });
      await this.connections.save(refreshed);
      return Object.freeze({
        accessToken: tokens.accessToken,
        sellerId: connection.sellerId,
      });
    } catch (error) {
      if (error instanceof MercadoLibreRemoteError && error.reauthorizationRequired) {
        await this.connections.markReauthorizationRequired(accountId, this.clock.now());
        throw new MercadoLibreIntegrationError(
          "mercadolibre-reauthorization-required",
          `MercadoLibre rejected the refresh token for ${accountId}.`,
        );
      }
      throw error;
    } finally {
      await this.connections.releaseRefreshLease(accountId, leaseOwner);
    }
  }

  private async requireCredential(accountId: string): Promise<MercadoLibreCredentialRecord> {
    const stored = await this.connections.get(accountId);
    if (!stored) {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-not-connected",
        `MercadoLibre account ${accountId} is not connected.`,
      );
    }
    return stored;
  }

  private assertUsableStatus(stored: MercadoLibreCredentialRecord): void {
    if (stored.connection.status === "reauthorization-required" || stored.connection.status === "revoked") {
      throw new MercadoLibreIntegrationError(
        "mercadolibre-reauthorization-required",
        `MercadoLibre account ${stored.connection.accountId} requires authorization again.`,
      );
    }
  }

  private tokenRemainsValid(stored: MercadoLibreCredentialRecord, now: Date): boolean {
    return (
      new Date(stored.connection.expiresAt).getTime() > now.getTime() + this.config.refreshWindowMs
    );
  }

  private revealCredential(
    stored: MercadoLibreCredentialRecord,
  ): MercadoLibreQuestionAnswerCredential {
    const context = credentialContext(stored.connection.accountId, stored.connection.sellerId);
    return Object.freeze({
      accessToken: this.security.reveal(stored.protectedAccessToken, `${context}:access`),
      sellerId: stored.connection.sellerId,
    });
  }
}

function credentialContext(accountId: string, sellerId: string): string {
  return `mercadolibre:credential:${accountId}:${sellerId}`;
}
