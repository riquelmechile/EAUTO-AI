export type OutboxStatus = "pending" | "processing" | "processed" | "dead";

export type OutboxEventDraft = Readonly<{
  id: string;
  idempotencyKey: string;
  aggregateType: string;
  aggregateId: string;
  accountId?: string;
  eventType: string;
  payload: unknown;
  availableAt: string;
}>;

export type ClaimedOutboxEvent = Readonly<
  OutboxEventDraft & {
    status: "processing";
    attempts: number;
    lockedBy: string;
    lockedUntil: string;
    createdAt: string;
  }
>;

export type DeadOutboxEvent = Readonly<
  OutboxEventDraft & {
    status: "dead";
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }
>;

export type OutboxStats = Readonly<{
  pending: number;
  processing: number;
  processed: number;
  dead: number;
}>;

export type OutboxRepository = {
  enqueue(event: OutboxEventDraft): Promise<void>;
  claimBatch(input: {
    workerId: string;
    limit: number;
    now: string;
    lockedUntil: string;
  }): Promise<readonly ClaimedOutboxEvent[]>;
  markProcessed(input: { id: string; workerId: string; processedAt: string }): Promise<void>;
  markFailed(input: {
    id: string;
    workerId: string;
    error: string;
    retryAt: string;
    maxAttempts: number;
  }): Promise<"pending" | "dead">;
  listDead(input: {
    accountIds: readonly string[];
    limit: number;
  }): Promise<readonly DeadOutboxEvent[]>;
  requeueDead(input: {
    id: string;
    accountIds: readonly string[];
    availableAt: string;
  }): Promise<void>;
  stats(accountIds?: readonly string[]): Promise<OutboxStats>;
};

export type OutboxEventHandler = (event: ClaimedOutboxEvent) => Promise<void>;

export type OutboxProcessorResult = Readonly<{
  claimed: number;
  processed: number;
  retried: number;
  dead: number;
}>;

export class OutboxProcessor {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly handlers: Readonly<Record<string, OutboxEventHandler>>,
    private readonly options: Readonly<{
      workerId: string;
      leaseMs: number;
      maxAttempts: number;
      baseRetryMs: number;
      maxRetryMs: number;
      now(): Date;
    }>,
  ) {}

  async runOnce(limit: number): Promise<OutboxProcessorResult> {
    const now = this.options.now();
    const events = await this.repository.claimBatch({
      workerId: this.options.workerId,
      limit,
      now: now.toISOString(),
      lockedUntil: new Date(now.getTime() + this.options.leaseMs).toISOString(),
    });

    let processed = 0;
    let retried = 0;
    let dead = 0;

    for (const event of events) {
      try {
        const handler = this.handlers[event.eventType];
        if (!handler) throw new Error(`No handler registered for ${event.eventType}.`);
        await handler(event);
        await this.repository.markProcessed({
          id: event.id,
          workerId: this.options.workerId,
          processedAt: this.options.now().toISOString(),
        });
        processed += 1;
      } catch (error) {
        const retryDelay = Math.min(
          this.options.maxRetryMs,
          this.options.baseRetryMs * 2 ** Math.max(0, event.attempts - 1),
        );
        const status = await this.repository.markFailed({
          id: event.id,
          workerId: this.options.workerId,
          error: error instanceof Error ? error.message : "Unknown outbox handler error",
          retryAt: new Date(this.options.now().getTime() + retryDelay).toISOString(),
          maxAttempts: this.options.maxAttempts,
        });
        if (status === "dead") dead += 1;
        else retried += 1;
      }
    }

    return Object.freeze({ claimed: events.length, processed, retried, dead });
  }
}
