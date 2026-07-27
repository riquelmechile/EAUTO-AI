import { describe, expect, it } from "vitest";
import type { MercadoLibreService } from "@eauto/application";
import {
  MercadoLibreNotificationIngestionService,
  MercadoLibreNotificationProcessor,
} from "@eauto/application";
import { InMemoryMercadoLibreNotificationRepository } from "@eauto/infrastructure";

function ingestion(repository: InMemoryMercadoLibreNotificationRepository) {
  let sequence = 0;
  return new MercadoLibreNotificationIngestionService(repository, {
    applicationId: "app-123",
    organizationId: "maustian",
    accountBySellerId: Object.freeze({ "111": "plasticov", "222": "maustian" }),
    now: () => new Date("2026-07-26T12:00:00.000Z"),
    nextId: () => `notification-${++sequence}`,
  });
}

const basePayload = Object.freeze({
  notificationId: "delivery-1",
  applicationId: "app-123",
  sellerId: "111",
  topic: "orders_v2",
  resource: "/orders/5001",
  sentAt: "2026-07-26T11:59:00.000Z",
  receivedAt: "2026-07-26T12:00:00.000Z",
  attempts: 1,
});

describe("MercadoLibre notification ingestion", () => {
  it("deduplicates the same delivery and preserves seller scope", async () => {
    const repository = new InMemoryMercadoLibreNotificationRepository();
    const service = ingestion(repository);

    await expect(service.ingest(basePayload)).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      accountId: "plasticov",
    });
    await expect(service.ingest(basePayload)).resolves.toMatchObject({
      accepted: true,
      duplicate: true,
    });
    await expect(repository.stats("plasticov")).resolves.toMatchObject({ pending: 1 });
    await expect(repository.stats("maustian")).resolves.toMatchObject({ pending: 0 });
  });

  it("rejects unknown applications, sellers and topics without persistence", async () => {
    const repository = new InMemoryMercadoLibreNotificationRepository();
    const service = ingestion(repository);

    await expect(service.ingest({ ...basePayload, applicationId: "other-app" })).resolves.toEqual({
      accepted: false,
      reason: "application-mismatch",
    });
    await expect(service.ingest({ ...basePayload, sellerId: "999" })).resolves.toEqual({
      accepted: false,
      reason: "unknown-seller",
    });
    await expect(service.ingest({ ...basePayload, topic: "messages" })).resolves.toEqual({
      accepted: false,
      reason: "unsupported-topic",
    });
    await expect(repository.stats()).resolves.toEqual({
      pending: 0,
      processing: 0,
      processed: 0,
      dead: 0,
    });
  });
});

describe("MercadoLibre notification processing", () => {
  it("groups commercial signals from the same account into one sync", async () => {
    const repository = new InMemoryMercadoLibreNotificationRepository();
    const service = ingestion(repository);
    await service.ingest(basePayload);
    await service.ingest({
      ...basePayload,
      notificationId: "delivery-2",
      topic: "shipments",
      resource: "/shipments/9001",
    });

    let commercialCalls = 0;
    const fakeService = {
      syncReadModel: () => Promise.reject(new Error("unexpected catalog sync")),
      syncCustomerOperations: () => Promise.reject(new Error("unexpected customer sync")),
      syncCommercialOperations: () => {
        commercialCalls += 1;
        return Promise.resolve({});
      },
    } as unknown as MercadoLibreService;
    const processor = new MercadoLibreNotificationProcessor(repository, fakeService, {
      workerId: "worker-1",
      leaseMs: 30_000,
      maxAttempts: 3,
      baseRetryMs: 1_000,
      maxRetryMs: 60_000,
      batchSize: 100,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });

    await expect(processor.processBatch()).resolves.toEqual({
      leased: 2,
      processed: 2,
      failed: 0,
    });
    expect(commercialCalls).toBe(1);
    await expect(repository.stats("plasticov")).resolves.toMatchObject({ processed: 2 });
  });

  it("moves repeated failures to dead-letter and permits scoped replay", async () => {
    const repository = new InMemoryMercadoLibreNotificationRepository();
    await ingestion(repository).ingest(basePayload);
    const failing = {
      syncReadModel: () => Promise.reject(new Error("remote unavailable")),
      syncCustomerOperations: () => Promise.reject(new Error("remote unavailable")),
      syncCommercialOperations: () => Promise.reject(new Error("remote unavailable")),
    } as unknown as MercadoLibreService;
    let current = new Date("2026-07-26T12:00:00.000Z");
    const processor = new MercadoLibreNotificationProcessor(repository, failing, {
      workerId: "worker-1",
      leaseMs: 30_000,
      maxAttempts: 2,
      baseRetryMs: 1_000,
      maxRetryMs: 60_000,
      batchSize: 100,
      now: () => current,
    });

    await processor.processBatch();
    current = new Date("2026-07-26T12:00:02.000Z");
    await processor.processBatch();
    const dead = await repository.listDead("plasticov", 10);
    expect(dead).toHaveLength(1);
    expect(dead[0]?.lastError).toContain("remote unavailable");
    await expect(
      repository.requeueDead({
        id: dead[0]!.id,
        accountId: "maustian",
        availableAt: current,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.requeueDead({
        id: dead[0]!.id,
        accountId: "plasticov",
        availableAt: current,
      }),
    ).resolves.toBe(true);
  });
});
