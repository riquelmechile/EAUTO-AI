import { describe, expect, it } from "vitest";
import {
  MercadoLibreIntegrationError,
  MercadoLibreWriteBlockedError,
  assertMercadoLibreWriteDisabled,
} from "@eauto/domain";
import {
  MercadoLibreService,
  type MercadoLibreClientPort,
  type MercadoLibreRemoteUser,
  type MercadoLibreTokenSet,
} from "@eauto/application";
import {
  InMemoryMercadoLibreConnectionRepository,
  InMemoryMercadoLibreOAuthStateRepository,
  NodeMercadoLibreSecurity,
} from "@eauto/infrastructure";

class FakeMercadoLibreClient implements MercadoLibreClientPort {
  refreshCalls = 0;
  user: MercadoLibreRemoteUser = Object.freeze({
    id: "111",
    nickname: "PLASTICOV",
    siteId: "MLC",
  });

  exchangeAuthorizationCode(): Promise<MercadoLibreTokenSet> {
    return Promise.resolve(
      Object.freeze({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresInSeconds: 10,
        tokenType: "bearer",
        scopes: ["read"],
        userId: this.user.id,
      }),
    );
  }

  refreshAccessToken(): Promise<MercadoLibreTokenSet> {
    this.refreshCalls += 1;
    return Promise.resolve(
      Object.freeze({
        accessToken: "access-2",
        refreshToken: "refresh-2",
        expiresInSeconds: 21_600,
        tokenType: "bearer",
        scopes: ["read"],
        userId: this.user.id,
      }),
    );
  }

  getCurrentUser(): Promise<MercadoLibreRemoteUser> {
    return Promise.resolve(this.user);
  }

  listSellerListings() {
    return Promise.resolve([
      Object.freeze({
        itemId: "MLC1",
        title: "Producto de prueba",
        status: "active",
        priceMinor: 19_990,
        currencyId: "CLP",
        availableQuantity: 4,
        soldQuantity: 3,
        sourceHash: "hash-1",
      }),
    ]);
  }

  searchSellerClaims() {
    return Promise.resolve([
      Object.freeze({
        claimId: "9001",
        resourceId: "order-1",
        resource: "order",
        status: "opened",
        type: "mediations",
        stage: "claim",
        reasonId: "PDD",
        fulfilled: false,
        dateCreated: "2026-07-26T10:00:00.000Z",
        lastUpdated: "2026-07-26T11:00:00.000Z",
        sourceHash: "claim-hash",
      }),
    ]);
  }

  searchSellerQuestions() {
    return Promise.resolve([
      Object.freeze({
        questionId: "7001",
        itemId: "MLC1",
        status: "UNANSWERED",
        dateCreated: "2026-07-26T11:30:00.000Z",
        hasAnswer: false,
        hold: false,
        suspectedSpam: false,
        sourceHash: "question-hash",
      }),
    ]);
  }
}

function createFixture() {
  const now = new Date("2026-07-26T12:00:00.000Z");
  const states = new InMemoryMercadoLibreOAuthStateRepository();
  const connections = new InMemoryMercadoLibreConnectionRepository();
  const security = new NodeMercadoLibreSecurity(Buffer.alloc(32, 7).toString("base64"));
  const client = new FakeMercadoLibreClient();
  const service = new MercadoLibreService(
    states,
    connections,
    security,
    client,
    { now: () => now },
    {
      clientId: "client-1",
      redirectUri: "https://example.test/meli/callback",
      authorizationUrl: "https://auth.mercadolibre.cl/authorization",
      expectedSellerIds: { plasticov: "111", maustian: "222" },
      stateTtlMs: 600_000,
      refreshWindowMs: 300_000,
      refreshLeaseMs: 30_000,
    },
  );
  return { service, client };
}

async function authorizePlasticov(service: MercadoLibreService) {
  const started = await service.beginAuthorization({
    organizationId: "maustian",
    accountId: "plasticov",
  });
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  if (!state) throw new Error("Missing state");
  return { started, state };
}

describe("MercadoLibreService", () => {
  it("uses the Chile authorization host, PKCE and one-time state", async () => {
    const { service } = createFixture();
    const { started, state } = await authorizePlasticov(service);
    const url = new URL(started.authorizationUrl);

    expect(url.hostname).toBe("auth.mercadolibre.cl");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();

    const connection = await service.completeAuthorization({ state, code: "code-1" });
    expect(connection.siteId).toBe("MLC");
    expect(connection.sellerId).toBe("111");

    await expect(service.completeAuthorization({ state, code: "code-1" })).rejects.toMatchObject({
      code: "mercadolibre-invalid-state",
    });
  });

  it("rejects a seller or site that does not match the configured Chile account", async () => {
    const { service, client } = createFixture();
    client.user = Object.freeze({ id: "999", siteId: "MLB" });
    const { state } = await authorizePlasticov(service);

    await expect(service.completeAuthorization({ state, code: "code-1" })).rejects.toBeInstanceOf(
      MercadoLibreIntegrationError,
    );
  });

  it("refreshes lazily, rotates the refresh token and stores listing snapshots", async () => {
    const { service, client } = createFixture();
    const { state } = await authorizePlasticov(service);
    await service.completeAuthorization({ state, code: "code-1" });

    const result = await service.syncReadModel({
      organizationId: "maustian",
      accountId: "plasticov",
    });

    expect(client.refreshCalls).toBe(1);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toMatchObject({
      accountId: "plasticov",
      sellerId: "111",
      currencyId: "CLP",
      priceMinor: 19_990,
    });
  });

  it("stores compact claims and questions without buyer text or identity", async () => {
    const { service } = createFixture();
    const { state } = await authorizePlasticov(service);
    await service.completeAuthorization({ state, code: "code-1" });

    const result = await service.syncCustomerOperations({
      organizationId: "maustian",
      accountId: "plasticov",
    });

    expect(result.claims).toHaveLength(1);
    expect(result.questions).toHaveLength(1);
    expect(result.claims[0]).toMatchObject({
      accountId: "plasticov",
      sellerId: "111",
      status: "opened",
    });
    expect(result.questions[0]).toMatchObject({
      accountId: "plasticov",
      itemId: "MLC1",
      hasAnswer: false,
    });
    expect(result.questions[0]).not.toHaveProperty("text");
    expect(result.questions[0]).not.toHaveProperty("buyerId");
    expect(result.claims[0]).not.toHaveProperty("messages");
    expect(
      await service.listClaimSnapshots({
        organizationId: "maustian",
        accountId: "plasticov",
      }),
    ).toEqual(result.claims);
    expect(
      await service.listQuestionSnapshots({
        organizationId: "maustian",
        accountId: "plasticov",
      }),
    ).toEqual(result.questions);
  });
});

describe("MercadoLibre write boundary", () => {
  it("blocks every mutation until a separately verified write adapter exists", () => {
    expect(() => assertMercadoLibreWriteDisabled("answer-question", "111")).toThrow(
      MercadoLibreWriteBlockedError,
    );
  });
});
