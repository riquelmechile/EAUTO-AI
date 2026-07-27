import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { ClaimedOutboxEvent, OutboxEventHandler } from "@eauto/application";

export type ActionLifecycleDelivery = Readonly<{
  outboxEventId: string;
  accountId: string;
  actionId: string;
  eventType: string;
  payloadHash: string;
  payload: unknown;
  deliveredAt: string;
}>;

export class InMemoryActionLifecycleEventHandler {
  private readonly deliveries = new Map<string, ActionLifecycleDelivery>();

  readonly handle: OutboxEventHandler = (event) => {
    const delivery = toDelivery(event, new Date().toISOString());
    const existing = this.deliveries.get(event.id);
    if (existing && existing.payloadHash !== delivery.payloadHash) {
      throw new Error(`Outbox event ${event.id} changed after first delivery.`);
    }
    this.deliveries.set(event.id, delivery);
    return Promise.resolve();
  };

  list(): readonly ActionLifecycleDelivery[] {
    return Object.freeze([...this.deliveries.values()]);
  }
}

export class PostgresActionLifecycleEventHandler {
  constructor(private readonly pool: Pool) {}

  readonly handle: OutboxEventHandler = async (event) => {
    const delivery = toDelivery(event, new Date().toISOString());
    const result = await this.pool.query<{ payload_hash: string }>(
      `INSERT INTO action_lifecycle_delivery_log
        (outbox_event_id, account_id, action_id, event_type, payload_hash, payload_json, delivered_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT (outbox_event_id) DO NOTHING
       RETURNING payload_hash`,
      [
        delivery.outboxEventId,
        delivery.accountId,
        delivery.actionId,
        delivery.eventType,
        delivery.payloadHash,
        JSON.stringify(delivery.payload),
        delivery.deliveredAt,
      ],
    );
    if (result.rowCount === 1) return;
    const existing = await this.pool.query<{ payload_hash: string }>(
      `SELECT payload_hash FROM action_lifecycle_delivery_log WHERE outbox_event_id = $1`,
      [delivery.outboxEventId],
    );
    if (existing.rows[0]?.payload_hash !== delivery.payloadHash) {
      throw new Error(`Outbox event ${event.id} conflicts with an existing delivery.`);
    }
  };
}

function toDelivery(event: ClaimedOutboxEvent, deliveredAt: string): ActionLifecycleDelivery {
  if (event.aggregateType !== "business_action") {
    throw new Error(`Unsupported lifecycle aggregate ${event.aggregateType}.`);
  }
  if (!event.accountId) throw new Error(`Lifecycle event ${event.id} is missing accountId.`);
  return Object.freeze({
    outboxEventId: event.id,
    accountId: event.accountId,
    actionId: event.aggregateId,
    eventType: event.eventType,
    payloadHash: createHash("sha256").update(canonicalJson(event.payload), "utf8").digest("hex"),
    payload: event.payload,
    deliveredAt,
  });
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}
