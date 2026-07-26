import { describe, expect, it } from "vitest";
import { OutboxProcessor, type OutboxEventDraft } from "@eauto/application";
import { InMemoryOutboxRepository } from "@eauto/infrastructure";

const event: OutboxEventDraft = Object.freeze({
  id: "event-1",
  idempotencyKey: "action-1:proposed",
  aggregateType: "business_action",
  aggregateId: "action-1",
  accountId: "plasticov",
  eventType: "action.proposed",
  payload: { actionId: "action-1" },
  availableAt: "2026-07-26T00:00:00.000Z",
});

describe("OutboxProcessor", () => {
  it("claims and processes an event exactly once", async () => {
    const repository = new InMemoryOutboxRepository();
    await repository.enqueue(event);
    await repository.enqueue({ ...event, id: "event-duplicate" });
    let handled = 0;
    const processor = new OutboxProcessor(
      repository,
      {
        "action.proposed": () => {
          handled += 1;
          return Promise.resolve();
        },
      },
      {
        workerId: "worker-1",
        leaseMs: 30_000,
        maxAttempts: 3,
        baseRetryMs: 1_000,
        maxRetryMs: 10_000,
        now: () => new Date("2026-07-26T00:00:01.000Z"),
      },
    );

    expect(await processor.runOnce(10)).toEqual({
      claimed: 1,
      processed: 1,
      retried: 0,
      dead: 0,
    });
    expect(await processor.runOnce(10)).toEqual({
      claimed: 0,
      processed: 0,
      retried: 0,
      dead: 0,
    });
    expect(handled).toBe(1);
    expect(await repository.stats()).toEqual({
      pending: 0,
      processing: 0,
      processed: 1,
      dead: 0,
    });
  });

  it("retries, dead-letters poison events and allows explicit replay", async () => {
    const repository = new InMemoryOutboxRepository();
    await repository.enqueue(event);
    let now = new Date("2026-07-26T00:00:01.000Z");
    const processor = new OutboxProcessor(
      repository,
      { "action.proposed": () => Promise.reject(new Error("poison-event")) },
      {
        workerId: "worker-1",
        leaseMs: 30_000,
        maxAttempts: 2,
        baseRetryMs: 1_000,
        maxRetryMs: 10_000,
        now: () => now,
      },
    );

    expect((await processor.runOnce(1)).retried).toBe(1);
    now = new Date("2026-07-26T00:00:03.000Z");
    expect((await processor.runOnce(1)).dead).toBe(1);
    expect((await repository.listDead(10))[0]).toMatchObject({
      id: "event-1",
      attempts: 2,
      lastError: "poison-event",
    });

    await repository.requeueDead({
      id: "event-1",
      availableAt: "2026-07-26T00:00:04.000Z",
    });
    expect(await repository.stats()).toEqual({
      pending: 1,
      processing: 0,
      processed: 0,
      dead: 0,
    });
  });
});
