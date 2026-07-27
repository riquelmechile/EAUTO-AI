import type { Pool } from "pg";
import type {
  MercadoLibreNotification,
  MercadoLibreNotificationRepository,
  MercadoLibreNotificationStats,
} from "@eauto/application";

type NotificationRow = { payload_json: MercadoLibreNotification };

export class InMemoryMercadoLibreNotificationRepository
  implements MercadoLibreNotificationRepository
{
  private readonly records = new Map<string, MercadoLibreNotification>();
  private readonly idempotencyKeys = new Set<string>();

  enqueue(notification: MercadoLibreNotification): Promise<"accepted" | "duplicate"> {
    if (this.idempotencyKeys.has(notification.idempotencyKey)) {
      return Promise.resolve("duplicate");
    }
    this.idempotencyKeys.add(notification.idempotencyKey);
    this.records.set(notification.id, notification);
    return Promise.resolve("accepted");
  }

  leaseBatch(input: {
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly MercadoLibreNotification[]> {
    const now = input.now.getTime();
    const records = [...this.records.values()]
      .filter(
        (record) =>
          Date.parse(record.availableAt) <= now &&
          (record.status === "pending" ||
            (record.status === "processing" &&
              record.leaseUntil !== undefined &&
              Date.parse(record.leaseUntil) <= now)),
      )
      .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
      .slice(0, input.limit)
      .map((record) => {
        const leased = Object.freeze({
          ...withoutOutcome(record),
          status: "processing" as const,
          attempts: record.attempts + 1,
          leaseOwner: input.owner,
          leaseUntil: input.leaseUntil.toISOString(),
        });
        this.records.set(record.id, leased);
        return leased;
      });
    return Promise.resolve(records);
  }

  markProcessed(input: {
    ids: readonly string[];
    owner: string;
    processedAt: Date;
  }): Promise<void> {
    for (const id of input.ids) {
      const record = this.requireOwned(id, input.owner);
      this.records.set(
        id,
        Object.freeze({
          ...withoutOutcome(record),
          status: "processed",
          processedAt: input.processedAt.toISOString(),
        }),
      );
    }
    return Promise.resolve();
  }

  markFailed(input: {
    id: string;
    owner: string;
    error: string;
    availableAt: Date;
    dead: boolean;
  }): Promise<void> {
    const record = this.requireOwned(input.id, input.owner);
    this.records.set(
      input.id,
      Object.freeze({
        ...withoutLease(record),
        status: input.dead ? "dead" : "pending",
        availableAt: input.availableAt.toISOString(),
        lastError: input.error,
      }),
    );
    return Promise.resolve();
  }

  stats(accountId?: string): Promise<MercadoLibreNotificationStats> {
    const stats = { pending: 0, processing: 0, processed: 0, dead: 0 };
    for (const record of this.records.values()) {
      if (!accountId || record.accountId === accountId) stats[record.status] += 1;
    }
    return Promise.resolve(Object.freeze(stats));
  }

  listDead(accountId: string, limit: number): Promise<readonly MercadoLibreNotification[]> {
    return Promise.resolve(
      Object.freeze(
        [...this.records.values()]
          .filter((record) => record.accountId === accountId && record.status === "dead")
          .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
          .slice(0, limit),
      ),
    );
  }

  requeueDead(input: { id: string; accountId: string; availableAt: Date }): Promise<boolean> {
    const record = this.records.get(input.id);
    if (!record || record.accountId !== input.accountId || record.status !== "dead") {
      return Promise.resolve(false);
    }
    this.records.set(
      input.id,
      Object.freeze({
        ...withoutOutcome(record),
        status: "pending",
        attempts: 0,
        availableAt: input.availableAt.toISOString(),
      }),
    );
    return Promise.resolve(true);
  }

  private requireOwned(id: string, owner: string): MercadoLibreNotification {
    const record = this.records.get(id);
    if (!record) throw new Error(`MercadoLibre notification ${id} not found.`);
    if (record.status !== "processing" || record.leaseOwner !== owner) {
      throw new Error(`MercadoLibre notification ${id} is not leased by ${owner}.`);
    }
    return record;
  }
}

export class PostgresMercadoLibreNotificationRepository
  implements MercadoLibreNotificationRepository
{
  constructor(private readonly pool: Pool) {}

  async enqueue(notification: MercadoLibreNotification): Promise<"accepted" | "duplicate"> {
    const result = await this.pool.query(
      `INSERT INTO mercadolibre_notifications
        (id, idempotency_key, application_id, organization_id, account_id, seller_id,
         topic, resource, status, attempts, available_at, received_at, payload_hash, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',0,$9,$10,$11,$12::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        notification.id,
        notification.idempotencyKey,
        notification.applicationId,
        notification.organizationId,
        notification.accountId,
        notification.sellerId,
        notification.topic,
        notification.resource,
        notification.availableAt,
        notification.receivedAt,
        notification.payloadHash,
        JSON.stringify(notification),
      ],
    );
    return result.rowCount === 1 ? "accepted" : "duplicate";
  }

  async leaseBatch(input: {
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly MercadoLibreNotification[]> {
    const result = await this.pool.query<NotificationRow>(
      `WITH candidates AS (
         SELECT id
         FROM mercadolibre_notifications
         WHERE available_at <= $1
           AND (
             status = 'pending'
             OR (status = 'processing' AND lease_until IS NOT NULL AND lease_until <= $1)
           )
         ORDER BY received_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE mercadolibre_notifications AS notification
       SET status = 'processing',
           attempts = notification.attempts + 1,
           lease_owner = $3,
           lease_until = $4,
           last_error = NULL,
           payload_json = jsonb_set(
             jsonb_set(
               jsonb_set(notification.payload_json - 'lastError', '{status}', '"processing"'::jsonb, true),
               '{attempts}', to_jsonb(notification.attempts + 1), true
             ),
             '{leaseOwner}', to_jsonb($3::text), true
           ) || jsonb_build_object('leaseUntil', $4::text),
           updated_at = now()
       FROM candidates
       WHERE notification.id = candidates.id
       RETURNING notification.payload_json`,
      [input.now.toISOString(), input.limit, input.owner, input.leaseUntil.toISOString()],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async markProcessed(input: {
    ids: readonly string[];
    owner: string;
    processedAt: Date;
  }): Promise<void> {
    if (input.ids.length === 0) return;
    const result = await this.pool.query(
      `UPDATE mercadolibre_notifications
       SET status = 'processed',
           processed_at = $3,
           lease_owner = NULL,
           lease_until = NULL,
           payload_json = jsonb_set(
             notification_without_lease(payload_json) - 'lastError',
             '{status}', '"processed"'::jsonb, true
           ) || jsonb_build_object('processedAt', $3::text),
           updated_at = now()
       WHERE id = ANY($1::text[]) AND status = 'processing' AND lease_owner = $2`,
      [input.ids, input.owner, input.processedAt.toISOString()],
    );
    if (result.rowCount !== input.ids.length) {
      throw new Error("One or more MercadoLibre notification leases were lost.");
    }
  }

  async markFailed(input: {
    id: string;
    owner: string;
    error: string;
    availableAt: Date;
    dead: boolean;
  }): Promise<void> {
    const status = input.dead ? "dead" : "pending";
    const result = await this.pool.query(
      `UPDATE mercadolibre_notifications
       SET status = $4,
           available_at = $3,
           last_error = $5,
           lease_owner = NULL,
           lease_until = NULL,
           payload_json = jsonb_set(
             notification_without_lease(payload_json),
             '{status}', to_jsonb($4::text), true
           ) || jsonb_build_object('availableAt', $3::text, 'lastError', $5::text),
           updated_at = now()
       WHERE id = $1 AND status = 'processing' AND lease_owner = $2`,
      [input.id, input.owner, input.availableAt.toISOString(), status, input.error],
    );
    if (result.rowCount !== 1) throw new Error(`Notification lease lost for ${input.id}.`);
  }

  async stats(accountId?: string): Promise<MercadoLibreNotificationStats> {
    const result = await this.pool.query<{ status: string; count: string }>(
      `SELECT status, count(*)::text AS count
       FROM mercadolibre_notifications
       WHERE ($1::text IS NULL OR account_id = $1)
       GROUP BY status`,
      [accountId ?? null],
    );
    const stats = { pending: 0, processing: 0, processed: 0, dead: 0 };
    for (const row of result.rows) {
      if (row.status in stats) stats[row.status as keyof typeof stats] = Number(row.count);
    }
    return Object.freeze(stats);
  }

  async listDead(accountId: string, limit: number): Promise<readonly MercadoLibreNotification[]> {
    const result = await this.pool.query<NotificationRow>(
      `SELECT payload_json
       FROM mercadolibre_notifications
       WHERE account_id = $1 AND status = 'dead'
       ORDER BY received_at DESC
       LIMIT $2`,
      [accountId, limit],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async requeueDead(input: {
    id: string;
    accountId: string;
    availableAt: Date;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE mercadolibre_notifications
       SET status = 'pending', attempts = 0, available_at = $3,
           last_error = NULL, processed_at = NULL, lease_owner = NULL, lease_until = NULL,
           payload_json = jsonb_set(
             jsonb_set(notification_without_lease(payload_json) - 'lastError' - 'processedAt',
               '{status}', '"pending"'::jsonb, true),
             '{attempts}', '0'::jsonb, true
           ) || jsonb_build_object('availableAt', $3::text),
           updated_at = now()
       WHERE id = $1 AND account_id = $2 AND status = 'dead'`,
      [input.id, input.accountId, input.availableAt.toISOString()],
    );
    return result.rowCount === 1;
  }
}

function withoutLease(record: MercadoLibreNotification): MercadoLibreNotification {
  return stripKeys(record, new Set(["leaseOwner", "leaseUntil"]));
}

function withoutOutcome(record: MercadoLibreNotification): MercadoLibreNotification {
  return stripKeys(
    record,
    new Set(["leaseOwner", "leaseUntil", "lastError", "processedAt"]),
  );
}

function stripKeys(
  record: MercadoLibreNotification,
  keys: ReadonlySet<string>,
): MercadoLibreNotification {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !keys.has(key)),
  ) as MercadoLibreNotification;
}
