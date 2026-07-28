import { describe, expect, it, vi } from "vitest";
import { MercadoLibreRemoteError } from "@eauto/application";
import type { MercadoLibreCredentialRecord } from "@eauto/application";
import type { MercadoLibreConnection } from "@eauto/domain";
import { RotatingMercadoLibreQuestionAnswerCredentialProvider } from "../packages/infrastructure/src/mercadoLibreQuestionAnswerCredentialProvider.js";

const now = new Date("2026-07-28T12:00:00.000Z");

function connection(expiresAt: string): MercadoLibreConnection {
  return Object.freeze({
    organizationId: "maustian",
    accountId: "plasticov",
    sellerId: "123456789",
    siteId: "MLC",
    scopes: Object.freeze(["read", "write"]),
    status: "active",
    expiresAt,
    updatedAt: "2026-07-28T11:00:00.000Z",
  });
}

function createHarness(expiresAt: string) {
  let stored: MercadoLibreCredentialRecord = Object.freeze({
    connection: connection(expiresAt),
    protectedAccessToken: "protected-access",
    protectedRefreshToken: "protected-refresh",
    tokenType: "Bearer",
  });
  const connections = {
    get: vi.fn(() => Promise.resolve(stored)),
    save: vi.fn((record: MercadoLibreCredentialRecord) => {
      stored = record;
      return Promise.resolve();
    }),
    acquireRefreshLease: vi.fn(() => Promise.resolve(true)),
    releaseRefreshLease: vi.fn(() => Promise.resolve()),
    markReauthorizationRequired: vi.fn(() => Promise.resolve()),
    replaceListingSnapshots: vi.fn(() => Promise.resolve()),
    listListingSnapshots: vi.fn(() => Promise.resolve([])),
    replaceClaimSnapshots: vi.fn(() => Promise.resolve()),
    listClaimSnapshots: vi.fn(() => Promise.resolve([])),
    replaceQuestionSnapshots: vi.fn(() => Promise.resolve()),
    listQuestionSnapshots: vi.fn(() => Promise.resolve([])),
    replaceOrderSnapshots: vi.fn(() => Promise.resolve()),
    listOrderSnapshots: vi.fn(() => Promise.resolve([])),
    saveReputationSnapshot: vi.fn(() => Promise.resolve()),
    getReputationSnapshot: vi.fn(() => Promise.resolve(null)),
  };
  const security = {
    createAuthorizationSecrets: vi.fn(() => ({
      state: "state",
      stateHash: "state-hash",
      verifier: "verifier",
      challenge: "challenge",
    })),
    hash: vi.fn((value: string) => value),
    randomId: vi.fn(() => "lease-owner"),
    protect: vi.fn((value: string) => `protected:${value}`),
    reveal: vi.fn((value: string) =>
      value === "protected-access" ? "access-token" : "refresh-token",
    ),
  };
  const client = {
    exchangeAuthorizationCode: vi.fn(),
    refreshAccessToken: vi.fn(() =>
      Promise.resolve({
        accessToken: "refreshed-access",
        refreshToken: "refreshed-refresh",
        expiresInSeconds: 21_600,
        tokenType: "Bearer",
        scopes: Object.freeze(["read", "write"]),
        userId: "123456789",
      }),
    ),
    getCurrentUser: vi.fn(),
    listSellerListings: vi.fn(),
    searchSellerClaims: vi.fn(),
    searchSellerQuestions: vi.fn(),
    searchSellerOrders: vi.fn(),
    getSellerReputation: vi.fn(),
  };
  const provider = new RotatingMercadoLibreQuestionAnswerCredentialProvider(
    connections,
    security,
    client,
    { now: () => now },
    {
      allowedAccountId: "plasticov",
      refreshWindowMs: 300_000,
      refreshLeaseMs: 30_000,
    },
  );
  return { provider, connections, security, client };
}

describe("RotatingMercadoLibreQuestionAnswerCredentialProvider", () => {
  it("reveals a still-valid encrypted access token without refreshing", async () => {
    const { provider, connections, security, client } = createHarness("2026-07-28T13:00:00.000Z");

    const credential = await provider.get("plasticov");

    expect(credential).toEqual({ accessToken: "access-token", sellerId: "123456789" });
    expect(security.reveal).toHaveBeenCalledWith(
      "protected-access",
      "mercadolibre:credential:plasticov:123456789:access",
    );
    expect(connections.acquireRefreshLease).not.toHaveBeenCalled();
    expect(client.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes under a lease, verifies seller identity and persists rotated tokens", async () => {
    const { provider, connections, client } = createHarness("2026-07-28T12:01:00.000Z");

    const credential = await provider.get("plasticov");

    expect(credential).toEqual({
      accessToken: "refreshed-access",
      sellerId: "123456789",
    });
    expect(client.refreshAccessToken).toHaveBeenCalledWith("refresh-token");
    expect(connections.save).toHaveBeenCalledWith(
      expect.objectContaining({
        protectedAccessToken: "protected:refreshed-access",
        protectedRefreshToken: "protected:refreshed-refresh",
      }),
    );
    expect(connections.releaseRefreshLease).toHaveBeenCalledWith("plasticov", "lease-owner");
  });

  it("marks reauthorization required when MercadoLibre rejects the refresh token", async () => {
    const { provider, connections, client } = createHarness("2026-07-28T12:01:00.000Z");
    client.refreshAccessToken.mockRejectedValueOnce(
      new MercadoLibreRemoteError("invalid refresh token", true),
    );

    await expect(provider.get("plasticov")).rejects.toThrow(
      /requires authorization again|rejected/,
    );
    expect(connections.markReauthorizationRequired).toHaveBeenCalledWith("plasticov", now);
    expect(connections.releaseRefreshLease).toHaveBeenCalledWith("plasticov", "lease-owner");
  });

  it("rejects every account outside the explicit rollout", async () => {
    const { provider, connections } = createHarness("2026-07-28T13:00:00.000Z");

    await expect(provider.get("maustian")).rejects.toThrow(/not configured/);
    expect(connections.get).not.toHaveBeenCalled();
  });
});
