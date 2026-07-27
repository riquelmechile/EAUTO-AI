import type { Pool } from "pg";
import type {
  ClaimedOutboxEvent,
  DeadOutboxEvent,
  OutboxEventDraft,
  OutboxRepository,
  OutboxStats,
} from "@eauto/application";

type OutboxRow = {
  id: string;
  idempotency_key: string;
  aggregate_type: string;
  aggregate_id: string;
  account_id: string | null;
  event_type: string;
  payload_json: unknown;
  attempts: number;
  locked_by: string;
  locked_until: Date | string;
  available_at: Date | string;
  created_at: Date | string;
};

type DeadOutboxRow = Omit<OutboxRow, "locked_by" | "locked_until"> & {
  last_error: string | null;
};

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(event: OutboxEventDraft): Promise<void> {
    await this.pool.query(
      `INSERT INTO transactional_outbox
        (id, idempotency_key, aggregate_type, aggregate_id, account_id, event_type, payload_json, status, available_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending', $8)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        event.id,
        event.idempotencyKey,
        event.aggregateType,
        event.aggregateId,
        event.accountId ?? null,
        event.eventType,
        JSON.stringify(event.payload),
        event.availableAt,
      ],
    );
  }

  async claimBatch(input: {
    workerId: string;
    limit: number;
    now: string;
    lockedUntil: string;
  }): Promise<readonly ClaimedOutboxEvent[]> {
    const result = await this.pool.query<OutboxRow>(
      `WITH candidates AS (
         SELECT id
         FROM transactional_outbox
         WHERE available_at <= $1
           AND (
             status = 'pending'
             OR (status = 'processing' AND locked_until IS NOT NULL AND locked_until <= $1)
           )
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE transactional_outbox AS outbox
       SET status = 'processing',
           attempts = outbox.attempts + 1,
           locked_by = $3,
           locked_until = $4,
           last_error = NULL
       FROM candidates
       WHERE outbox.id = candidates.id
       RETURNING outbox.id, outbox.idempotency_key, outbox.aggregate_type,
         outbox.aggregate_id, outbox.account_id, outbox.event_type, outbox.payload_json,
         outbox.attempts, outbox.locked_by, outbox.locked_until,
         outbox.available_at, outbox.created_at`,
      [input.now, input.limit, input.workerId, input.lockedUntil],
    );

    return result.rows.map((row) =>
      Object.freeze({
        id: row.id,
        idempotencyKey: row.idempotency_key,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        ...(row.account_id === null ? {} : { accountId: row.account_id }),
        eventType: row.event_type,
        payload: row.payload_json,
        availableAt: toIso(row.available_at),
        status: "processing" as const,
        attempts: row.attempts,
        lockedBy: row.locked_by,
        lockedUntil: toIso(row.locked_until),
        createdAt: toIso(row.created_at),
      }),
    );
  }

  async markProcessed(input: { id: string; workerId: string; processedAt: string }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE transactional_outbox
       SET status = 'processed', processed_at = $3, locked_by = NULL, locked_until = NULL
       WHERE id = $1 AND status = 'processing' AND locked_by = $2`,
      [input.id, input.workerId, input.processedAt],
    );
    if (result.rowCount !== 1) throw new Error(`Outbox lease lost for ${input.id}.`);
  }

  async markFailed(input: {
    id: string;
    workerId: string;
    error: string;
    retryAt: string;
    maxAttempts: number;
  }): Promise<"pending" | "dead"> {
    const result = await this.pool.query<{ status: "pending" | "dead" }>(
      `UPDATE transactional_outbox
       SET status = CASE WHEN attempts >= $4 THEN 'dead' ELSE 'pending' END,
           available_at = CASE WHEN attempts >= $4 THEN available_at ELSE $3 END,
           last_error = $5,
           locked_by = NULL,
           locked_until = NULL
       WHERE id = $1 AND status = 'processing' AND locked_by = $2
       RETURNING status`,
      [input.id, input.workerId, input.retryAt, input.maxAttempts, input.error],
    );
    const status = result.rows[0]?.status;
    if (!status) throw new Error(`Outbox lease lost for ${input.id}.`);
    return status;
  }

  async listDead(input: {
    accountIds: readonly string[];
    limit: number;
  }): Promise<readonly DeadOutboxEvent[]> {
    const result = await this.pool.query<DeadOutboxRow>(
      `SELECT id, idempotency_key, aggregate_type, aggregate_id, account_id,
         event_type, payload_json, attempts, last_error, available_at, created_at
       FROM transactional_outbox
       WHERE status = 'dead' AND account_id = ANY($1::text[])
       ORDER BY created_at ASC
       LIMIT $2`,
      [input.accountIds, input.limit],
    );
    return result.rows.map((row) =>
      Object.freeze({
        id: row.id,
        idempotencyKey: row.idempotency_key,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        ...(row.account_id === null ? {} : { accountId: row.account_id }),
        eventType: row.event_type,
        payload: row.payload_json,
        availableAt: toIso(row.available_at),
        status: "dead" as const,
        attempts: row.attempts,
        lastError: row.last_error,
        createdAt: toIso(row.created_at),
      }),
    );
  }

  async requeueDead(input: {
    id: string;
    accountIds: readonly string[];
    availableAt: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE transactional_outbox
       SET status = 'pending', attempts = 0, available_at = $3,
           last_error = NULL, locked_by = NULL, locked_until = NULL, processed_at = NULL
       WHERE id = $1 AND status = 'dead' AND account_id = ANY($2::text[])`,
      [input.id, input.accountIds, input.availableAt],
    );
    if (result.rowCount !== 1) throw new Error(`Dead-letter event ${input.id} not found.`);
  }

  async stats(accountIds?: readonly string[]): Promise<OutboxStats> {
    const result = await this.pool.query<{ status: string; count: string }>(
      `SELECT status, count(*)::text AS count
       FROM transactional_outbox
       WHERE ($1::text[] IS NULL OR account_id = ANY($1::text[]))
       GROUP BY status`,
      [accountIds ?? null],
    );
    const stats = { pending: 0, processing: 0, processed: 0, dead: 0 };
    for (const row of result.rows) {
      if (row.status in stats) stats[row.status as keyof typeof stats] = Number(row.count);
    }
    return Object.freeze(stats);
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
