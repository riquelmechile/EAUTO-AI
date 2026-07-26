import type {
  ClaimedOutboxEvent,
  OutboxEventDraft,
  OutboxRepository,
  OutboxStats,
  OutboxStatus,
} from "@eauto/application";

type StoredOutboxEvent = {
  event: OutboxEventDraft;
  status: OutboxStatus;
  attempts: number;
  lockedBy: string | null;
  lockedUntil: string | null;
  processedAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export class InMemoryOutboxRepository implements OutboxRepository {
  private readonly events = new Map<string, StoredOutboxEvent>();
  private readonly idempotencyKeys = new Set<string>();

  enqueue(event: OutboxEventDraft): Promise<void> {
    if (this.idempotencyKeys.has(event.idempotencyKey)) return Promise.resolve();
    this.idempotencyKeys.add(event.idempotencyKey);
    this.events.set(event.id, {
      event,
      status: "pending",
      attempts: 0,
      lockedBy: null,
      lockedUntil: null,
      processedAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
    });
    return Promise.resolve();
  }

  claimBatch(input: {
    workerId: string;
    limit: number;
    now: string;
    lockedUntil: string;
  }): Promise<readonly ClaimedOutboxEvent[]> {
    const now = Date.parse(input.now);
    const claimable = [...this.events.values()]
      .filter(
        (stored) =>
          Date.parse(stored.event.availableAt) <= now &&
          (stored.status === "pending" ||
            (stored.status === "processing" &&
              stored.lockedUntil !== null &&
              Date.parse(stored.lockedUntil) <= now)),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, input.limit);

    const claimed = claimable.map((stored) => {
      stored.status = "processing";
      stored.attempts += 1;
      stored.lockedBy = input.workerId;
      stored.lockedUntil = input.lockedUntil;
      return Object.freeze({
        ...stored.event,
        status: "processing" as const,
        attempts: stored.attempts,
        lockedBy: input.workerId,
        lockedUntil: input.lockedUntil,
        createdAt: stored.createdAt,
      });
    });

    return Promise.resolve(claimed);
  }

  markProcessed(input: { id: string; workerId: string; processedAt: string }): Promise<void> {
    const stored = this.requireOwned(input.id, input.workerId);
    stored.status = "processed";
    stored.processedAt = input.processedAt;
    stored.lockedBy = null;
    stored.lockedUntil = null;
    return Promise.resolve();
  }

  markFailed(input: {
    id: string;
    workerId: string;
    error: string;
    retryAt: string;
    maxAttempts: number;
  }): Promise<"pending" | "dead"> {
    const stored = this.requireOwned(input.id, input.workerId);
    stored.lastError = input.error;
    stored.lockedBy = null;
    stored.lockedUntil = null;
    if (stored.attempts >= input.maxAttempts) {
      stored.status = "dead";
      return Promise.resolve("dead");
    }
    stored.status = "pending";
    stored.event = Object.freeze({ ...stored.event, availableAt: input.retryAt });
    return Promise.resolve("pending");
  }

  stats(): Promise<OutboxStats> {
    const result: Record<OutboxStatus, number> = {
      pending: 0,
      processing: 0,
      processed: 0,
      dead: 0,
    };
    for (const stored of this.events.values()) result[stored.status] += 1;
    return Promise.resolve(Object.freeze(result));
  }

  private requireOwned(id: string, workerId: string): StoredOutboxEvent {
    const stored = this.events.get(id);
    if (!stored) throw new Error(`Outbox event ${id} not found.`);
    if (stored.status !== "processing" || stored.lockedBy !== workerId) {
      throw new Error(`Outbox event ${id} is not leased by ${workerId}.`);
    }
    return stored;
  }
}
