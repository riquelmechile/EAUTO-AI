import { createHash } from "node:crypto";
import type { MercadoLibreService } from "./mercadoLibreService.js";

export const MERCADOLIBRE_NOTIFICATION_TOPICS = [
  "items",
  "orders_v2",
  "questions",
  "claims",
  "shipments",
  "payments",
] as const;

export type MercadoLibreNotificationTopic =
  (typeof MERCADOLIBRE_NOTIFICATION_TOPICS)[number];
export type MercadoLibreNotificationStatus = "pending" | "processing" | "processed" | "dead";

export type MercadoLibreNotification = Readonly<{
  id: string;
  idempotencyKey: string;
  applicationId: string;
  organizationId: string;
  accountId: string;
  sellerId: string;
  topic: MercadoLibreNotificationTopic;
  resource: string;
  sentAt?: string;
  receivedAt: string;
  sourceAttempts: number;
  payloadHash: string;
  status: MercadoLibreNotificationStatus;
  attempts: number;
  availableAt: string;
  leaseOwner?: string;
  leaseUntil?: string;
  processedAt?: string;
  lastError?: string;
}>;

export type MercadoLibreWebhookPayload = Readonly<{
  notificationId: string;
  applicationId: string;
  sellerId: string;
  topic: string;
  resource: string;
  sentAt?: string;
  receivedAt?: string;
  attempts?: number;
}>;

export type MercadoLibreNotificationStats = Readonly<{
  pending: number;
  processing: number;
  processed: number;
  dead: number;
}>;

export interface MercadoLibreNotificationRepository {
  enqueue(notification: MercadoLibreNotification): Promise<"accepted" | "duplicate">;
  leaseBatch(input: {
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly MercadoLibreNotification[]>;
  markProcessed(input: {
    ids: readonly string[];
    owner: string;
    processedAt: Date;
  }): Promise<void>;
  markFailed(input: {
    id: string;
    owner: string;
    error: string;
    availableAt: Date;
    dead: boolean;
  }): Promise<void>;
  stats(accountId?: string): Promise<MercadoLibreNotificationStats>;
  listDead(accountId: string, limit: number): Promise<readonly MercadoLibreNotification[]>;
  requeueDead(input: { id: string; accountId: string; availableAt: Date }): Promise<boolean>;
}

export class MercadoLibreNotificationIngestionService {
  constructor(
    private readonly repository: MercadoLibreNotificationRepository,
    private readonly config: Readonly<{
      applicationId: string;
      organizationId: string;
      accountBySellerId: Readonly<Record<string, string>>;
      now(): Date;
      nextId(): string;
    }>,
  ) {}

  async ingest(payload: MercadoLibreWebhookPayload): Promise<
    | Readonly<{
        accepted: true;
        duplicate: boolean;
        accountId: string;
        topic: MercadoLibreNotificationTopic;
      }>
    | Readonly<{
        accepted: false;
        reason: "application-mismatch" | "unknown-seller" | "unsupported-topic";
      }>
  > {
    if (payload.applicationId !== this.config.applicationId) {
      return { accepted: false, reason: "application-mismatch" };
    }
    const accountId = this.config.accountBySellerId[payload.sellerId];
    if (!accountId) return { accepted: false, reason: "unknown-seller" };
    if (!isSupportedTopic(payload.topic)) {
      return { accepted: false, reason: "unsupported-topic" };
    }

    const now = this.config.now();
    const receivedAt = payload.receivedAt ?? now.toISOString();
    const sourceAttempts = payload.attempts ?? 0;
    const canonical = [
      payload.notificationId,
      payload.applicationId,
      payload.sellerId,
      payload.topic,
      payload.resource,
    ].join("\u001f");
    const idempotencyKey = sha256(canonical);
    const payloadHash = sha256(
      JSON.stringify({
        applicationId: payload.applicationId,
        sellerId: payload.sellerId,
        topic: payload.topic,
        resource: payload.resource,
        ...(payload.sentAt ? { sentAt: payload.sentAt } : {}),
        receivedAt,
        sourceAttempts,
      }),
    );

    const result = await this.repository.enqueue(
      Object.freeze({
        id: this.config.nextId(),
        idempotencyKey,
        applicationId: payload.applicationId,
        organizationId: this.config.organizationId,
        accountId,
        sellerId: payload.sellerId,
        topic: payload.topic,
        resource: payload.resource,
        ...(payload.sentAt ? { sentAt: payload.sentAt } : {}),
        receivedAt,
        sourceAttempts,
        payloadHash,
        status: "pending",
        attempts: 0,
        availableAt: now.toISOString(),
      }),
    );

    return {
      accepted: true,
      duplicate: result === "duplicate",
      accountId,
      topic: payload.topic,
    };
  }
}

export class MercadoLibreNotificationProcessor {
  constructor(
    private readonly repository: MercadoLibreNotificationRepository,
    private readonly mercadoLibre: MercadoLibreService,
    private readonly config: Readonly<{
      workerId: string;
      leaseMs: number;
      maxAttempts: number;
      baseRetryMs: number;
      maxRetryMs: number;
      batchSize: number;
      now(): Date;
    }>,
  ) {}

  async processBatch(): Promise<Readonly<{ leased: number; processed: number; failed: number }>> {
    const now = this.config.now();
    const notifications = await this.repository.leaseBatch({
      owner: this.config.workerId,
      now,
      leaseUntil: new Date(now.getTime() + this.config.leaseMs),
      limit: this.config.batchSize,
    });
    if (notifications.length === 0) return { leased: 0, processed: 0, failed: 0 };

    let processed = 0;
    let failed = 0;
    for (const group of groupNotifications(notifications)) {
      try {
        await this.synchronize(group.family, group.organizationId, group.accountId);
        await this.repository.markProcessed({
          ids: group.notifications.map((notification) => notification.id),
          owner: this.config.workerId,
          processedAt: this.config.now(),
        });
        processed += group.notifications.length;
      } catch (error) {
        for (const notification of group.notifications) {
          const nextAttempt = notification.attempts + 1;
          await this.repository.markFailed({
            id: notification.id,
            owner: this.config.workerId,
            error: sanitizeError(error),
            availableAt: new Date(
              this.config.now().getTime() + retryDelay(nextAttempt, this.config),
            ),
            dead: nextAttempt >= this.config.maxAttempts,
          });
          failed += 1;
        }
      }
    }
    return { leased: notifications.length, processed, failed };
  }

  private async synchronize(
    family: NotificationFamily,
    organizationId: string,
    accountId: string,
  ): Promise<void> {
    const input = { organizationId, accountId };
    switch (family) {
      case "catalog":
        await this.mercadoLibre.syncReadModel(input);
        return;
      case "customer":
        await this.mercadoLibre.syncCustomerOperations(input);
        return;
      case "commercial":
        await this.mercadoLibre.syncCommercialOperations(input);
        return;
    }
  }
}

type NotificationFamily = "catalog" | "customer" | "commercial";
type NotificationGroup = Readonly<{
  organizationId: string;
  accountId: string;
  family: NotificationFamily;
  notifications: readonly MercadoLibreNotification[];
}>;

function groupNotifications(
  notifications: readonly MercadoLibreNotification[],
): readonly NotificationGroup[] {
  const groups = new Map<string, MercadoLibreNotification[]>();
  for (const notification of notifications) {
    const family = familyForTopic(notification.topic);
    const key = `${notification.organizationId}\u001f${notification.accountId}\u001f${family}`;
    const current = groups.get(key) ?? [];
    current.push(notification);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, values]) => {
    const [organizationId, accountId, family] = key.split("\u001f") as [
      string,
      string,
      NotificationFamily,
    ];
    return Object.freeze({
      organizationId,
      accountId,
      family,
      notifications: Object.freeze(values),
    });
  });
}

function familyForTopic(topic: MercadoLibreNotificationTopic): NotificationFamily {
  switch (topic) {
    case "items":
      return "catalog";
    case "questions":
    case "claims":
      return "customer";
    case "orders_v2":
    case "shipments":
    case "payments":
      return "commercial";
  }
}

function isSupportedTopic(topic: string): topic is MercadoLibreNotificationTopic {
  return (MERCADOLIBRE_NOTIFICATION_TOPICS as readonly string[]).includes(topic);
}

function retryDelay(
  attempts: number,
  config: Readonly<{ baseRetryMs: number; maxRetryMs: number }>,
): number {
  const exponential = Math.min(
    config.maxRetryMs,
    config.baseRetryMs * 2 ** Math.max(0, attempts - 1),
  );
  const jitter = Math.floor(exponential * (((attempts * 37) % 17) / 100));
  return Math.min(config.maxRetryMs, exponential + jitter);
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown notification processing error";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
