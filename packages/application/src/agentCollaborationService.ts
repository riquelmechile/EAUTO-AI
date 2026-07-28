import { createHash } from "node:crypto";
import type {
  AgentMessage,
  EvidenceRequest,
  EvidenceResponse,
  EvidenceSubject,
  SemanticMemoryEntry,
  SemanticMemorySearchResult,
} from "@eauto/domain";
import {
  decideSemanticMemoryAdmission,
  reconcileSemanticMemory,
} from "@eauto/domain";

export type CollaborationScope = Readonly<{ organizationId: string; accountId: string }>;

export interface AgentCollaborationRepository {
  publishMessage(message: AgentMessage): Promise<AgentMessage>;
  listMessages(
    input: CollaborationScope & { conversationId?: string; limit: number },
  ): Promise<readonly AgentMessage[]>;
  leaseMessages(input: {
    recipientAgentId: string;
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly AgentMessage[]>;
  updateMessage(message: AgentMessage): Promise<void>;
  enqueueEvidenceRequest(request: EvidenceRequest): Promise<EvidenceRequest>;
  leaseEvidenceRequests(input: {
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly EvidenceRequest[]>;
  updateEvidenceRequest(request: EvidenceRequest): Promise<void>;
  saveEvidenceResponse(response: EvidenceResponse): Promise<void>;
  getEvidenceResponse(
    input: CollaborationScope & { requestId: string },
  ): Promise<EvidenceResponse | null>;
  saveSemanticMemory(entry: SemanticMemoryEntry): Promise<void>;
  updateSemanticMemory(entry: SemanticMemoryEntry): Promise<void>;
  listSemanticMemory(
    input: Readonly<{
      organizationId: string;
      accountId: string;
      topicKey?: string;
      limit: number;
    }>,
  ): Promise<readonly SemanticMemoryEntry[]>;
  searchSemanticMemory(input: {
    organizationId: string;
    accountId: string;
    query: string;
    limit: number;
  }): Promise<readonly SemanticMemorySearchResult[]>;
}

export interface EvidenceResponder {
  readonly id: string;
  readonly subjects: readonly EvidenceSubject[];
  respond(input: {
    organizationId: string;
    accountId: string;
    subject: EvidenceSubject;
    purpose: string;
    requiredKinds: readonly string[];
    asOf: string;
    maximumAgeMs: number;
  }): Promise<Readonly<{ documents: EvidenceResponse["documents"]; missingInputs: readonly string[] }>>;
}

export class AgentMessageBusService {
  constructor(
    private readonly repository: AgentCollaborationRepository,
    private readonly clock: { now(): Date },
    private readonly ids: { next(prefix: string): string },
  ) {}

  async publish(input: {
    idempotencyKey: string;
    organizationId: string;
    accountId: string;
    conversationId?: string;
    correlationId?: string;
    causationId?: string;
    senderAgentId: string;
    recipientAgentId: string;
    kind: AgentMessage["kind"];
    subject: string;
    payload: unknown;
    evidenceRefs?: readonly string[];
    maximumAttempts?: number;
  }): Promise<AgentMessage> {
    const now = this.clock.now().toISOString();
    const normalized = Object.freeze({
      idempotencyKey: required(input.idempotencyKey, "idempotencyKey", 256),
      organizationId: required(input.organizationId, "organizationId", 128),
      accountId: required(input.accountId, "accountId", 128),
      conversationId: input.conversationId
        ? required(input.conversationId, "conversationId", 256)
        : this.ids.next("conversation"),
      correlationId: input.correlationId
        ? required(input.correlationId, "correlationId", 256)
        : this.ids.next("correlation"),
      causationId: input.causationId ? required(input.causationId, "causationId", 256) : null,
      senderAgentId: required(input.senderAgentId, "senderAgentId", 128),
      recipientAgentId: required(input.recipientAgentId, "recipientAgentId", 128),
      kind: input.kind,
      subject: required(input.subject, "subject", 256),
      payload: input.payload,
      evidenceRefs: Object.freeze(unique(input.evidenceRefs ?? [])),
      maximumAttempts: positive(input.maximumAttempts ?? 5, "maximumAttempts"),
    });
    const message = Object.freeze({
      id: this.ids.next("agent-message"),
      ...normalized,
      status: "queued" as const,
      attempts: 0,
      availableAt: now,
      leaseOwner: null,
      leaseUntil: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      contentHash: hashJson(normalized),
    } satisfies AgentMessage);
    return this.repository.publishMessage(message);
  }

  list(input: CollaborationScope & { conversationId?: string; limit?: number }) {
    return this.repository.listMessages({ ...input, limit: bounded(input.limit ?? 100) });
  }

  lease(input: { recipientAgentId: string; owner: string; leaseMs: number; limit?: number }) {
    const now = this.clock.now();
    return this.repository.leaseMessages({
      recipientAgentId: required(input.recipientAgentId, "recipientAgentId", 128),
      owner: required(input.owner, "owner", 256),
      now,
      leaseUntil: new Date(now.getTime() + positive(input.leaseMs, "leaseMs")),
      limit: bounded(input.limit ?? 20),
    });
  }

  async complete(message: AgentMessage): Promise<void> {
    assertProcessing(message);
    const now = this.clock.now().toISOString();
    await this.repository.updateMessage(
      Object.freeze({
        ...message,
        status: "completed",
        leaseOwner: null,
        leaseUntil: null,
        failureReason: null,
        updatedAt: now,
        completedAt: now,
      }),
    );
  }

  async fail(message: AgentMessage, error: unknown, retryBaseMs = 5_000): Promise<void> {
    assertProcessing(message);
    const now = this.clock.now();
    const dead = message.attempts >= message.maximumAttempts;
    const retryAt = new Date(
      now.getTime() + retryBaseMs * 2 ** Math.max(0, message.attempts - 1),
    ).toISOString();
    await this.repository.updateMessage(
      Object.freeze({
        ...message,
        status: dead ? "dead" : "failed",
        availableAt: retryAt,
        leaseOwner: null,
        leaseUntil: null,
        failureReason: sanitizeError(error),
        updatedAt: now.toISOString(),
        completedAt: dead ? now.toISOString() : null,
      }),
    );
  }
}

export class EvidenceResponseRouter {
  private readonly responders: ReadonlyMap<string, EvidenceResponder>;

  constructor(
    responders: readonly EvidenceResponder[],
    private readonly repository: AgentCollaborationRepository,
    private readonly clock: { now(): Date },
    private readonly ids: { next(prefix: string): string },
    private readonly config: Readonly<{ workerId: string; leaseMs: number; maximumAttempts: number }>,
  ) {
    const uniqueResponders = new Map<string, EvidenceResponder>();
    for (const responder of responders) {
      if (uniqueResponders.has(responder.id)) throw new Error(`Duplicate responder ${responder.id}.`);
      uniqueResponders.set(responder.id, responder);
    }
    this.responders = uniqueResponders;
  }

  async request(input: {
    idempotencyKey: string;
    organizationId: string;
    accountId: string;
    conversationId: string;
    correlationId: string;
    requesterAgentId: string;
    responderId?: string;
    subject: EvidenceSubject;
    purpose: string;
    requiredKinds?: readonly string[];
    maximumAgeMs: number;
  }): Promise<EvidenceRequest> {
    const responder = input.responderId
      ? this.responders.get(input.responderId)
      : [...this.responders.values()].find((candidate) => candidate.subjects.includes(input.subject));
    if (!responder) throw new Error(`No evidence responder supports ${input.subject}.`);
    if (!responder.subjects.includes(input.subject)) {
      throw new Error(`Responder ${responder.id} does not support ${input.subject}.`);
    }
    const now = this.clock.now().toISOString();
    const normalized = Object.freeze({
      idempotencyKey: required(input.idempotencyKey, "idempotencyKey", 256),
      organizationId: required(input.organizationId, "organizationId", 128),
      accountId: required(input.accountId, "accountId", 128),
      conversationId: required(input.conversationId, "conversationId", 256),
      correlationId: required(input.correlationId, "correlationId", 256),
      requesterAgentId: required(input.requesterAgentId, "requesterAgentId", 128),
      responderId: responder.id,
      subject: input.subject,
      purpose: required(input.purpose, "purpose", 1_000),
      requiredKinds: Object.freeze(unique(input.requiredKinds ?? [])),
      maximumAgeMs: positive(input.maximumAgeMs, "maximumAgeMs"),
    });
    return this.repository.enqueueEvidenceRequest(
      Object.freeze({
        id: this.ids.next("evidence-request"),
        ...normalized,
        status: "queued",
        attempts: 0,
        maximumAttempts: positive(this.config.maximumAttempts, "maximumAttempts"),
        availableAt: now,
        leaseOwner: null,
        leaseUntil: null,
        failureReason: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        contentHash: hashJson(normalized),
      }),
    );
  }

  async processBatch(limit = 20): Promise<Readonly<{ leased: number; fulfilled: number; failed: number }>> {
    const now = this.clock.now();
    const requests = await this.repository.leaseEvidenceRequests({
      owner: this.config.workerId,
      now,
      leaseUntil: new Date(now.getTime() + this.config.leaseMs),
      limit: bounded(limit),
    });
    let fulfilled = 0;
    let failed = 0;
    for (const request of requests) {
      try {
        await this.process(request);
        fulfilled += 1;
      } catch (error) {
        await this.fail(request, error);
        failed += 1;
      }
    }
    return { leased: requests.length, fulfilled, failed };
  }

  private async process(request: EvidenceRequest): Promise<void> {
    const responder = this.responders.get(request.responderId);
    if (!responder) throw new Error(`Evidence responder ${request.responderId} is unavailable.`);
    const generatedAt = this.clock.now();
    const result = await responder.respond({
      organizationId: request.organizationId,
      accountId: request.accountId,
      subject: request.subject,
      purpose: request.purpose,
      requiredKinds: request.requiredKinds,
      asOf: generatedAt.toISOString(),
      maximumAgeMs: request.maximumAgeMs,
    });
    const missingKinds = request.requiredKinds.filter(
      (kind) => !result.documents.some((document) => document.kind === kind),
    );
    const missingInputs = Object.freeze(unique([...result.missingInputs, ...missingKinds]));
    const complete =
      result.documents.length > 0 &&
      missingInputs.length === 0 &&
      result.documents.every(
        (document) =>
          document.authority !== "advisory" &&
          document.reference.freshness === "fresh" &&
          Date.parse(document.expiresAt) > generatedAt.getTime(),
      );
    const expiresAt = new Date(generatedAt.getTime() + request.maximumAgeMs).toISOString();
    const normalized = Object.freeze({
      requestId: request.id,
      organizationId: request.organizationId,
      accountId: request.accountId,
      responderId: responder.id,
      subject: request.subject,
      documents: Object.freeze([...result.documents]),
      missingInputs,
      complete,
      generatedAt: generatedAt.toISOString(),
      expiresAt,
    });
    const response = Object.freeze({
      id: this.ids.next("evidence-response"),
      ...normalized,
      contentHash: hashJson(normalized),
    } satisfies EvidenceResponse);
    await this.repository.saveEvidenceResponse(response);
    await this.repository.updateEvidenceRequest(
      Object.freeze({
        ...request,
        status: complete ? "fulfilled" : "incomplete",
        leaseOwner: null,
        leaseUntil: null,
        failureReason: complete ? null : `missing-inputs:${missingInputs.join(",")}`,
        updatedAt: generatedAt.toISOString(),
        completedAt: generatedAt.toISOString(),
      }),
    );
  }

  private async fail(request: EvidenceRequest, error: unknown): Promise<void> {
    const now = this.clock.now();
    const dead = request.attempts >= request.maximumAttempts;
    await this.repository.updateEvidenceRequest(
      Object.freeze({
        ...request,
        status: dead ? "dead" : "failed",
        availableAt: new Date(now.getTime() + 5_000 * 2 ** Math.max(0, request.attempts - 1)).toISOString(),
        leaseOwner: null,
        leaseUntil: null,
        failureReason: sanitizeError(error),
        updatedAt: now.toISOString(),
        completedAt: dead ? now.toISOString() : null,
      }),
    );
  }
}

export class SemanticMemoryService {
  constructor(
    private readonly repository: AgentCollaborationRepository,
    private readonly clock: { now(): Date },
    private readonly ids: { next(prefix: string): string },
  ) {}

  async remember(input: {
    organizationId: string;
    accountId: string | null;
    topicKey: string;
    title: string;
    observation: string;
    rationale: string;
    scopeDescription: string;
    keywords?: readonly string[];
    sourceRefs: readonly string[];
    confidence: SemanticMemoryEntry["confidence"];
    verifiedOutcome: boolean;
    expiresAt?: string;
    supersedesId?: string;
    conflictsWithIds?: readonly string[];
  }): Promise<SemanticMemoryEntry> {
    const topicKey = normalizeTopic(input.topicKey);
    const existing = await this.repository.listSemanticMemory({
      organizationId: input.organizationId,
      accountId: input.accountId ?? "*",
      topicKey,
      limit: 100,
    });
    const reconciliation = reconcileSemanticMemory({
      candidateTopicKey: topicKey,
      candidateSourceRefs: input.sourceRefs,
      existing,
      ...(input.supersedesId ? { supersedesId: input.supersedesId } : {}),
      ...(input.conflictsWithIds ? { conflictsWithIds: input.conflictsWithIds } : {}),
    });
    const now = this.clock.now().toISOString();
    const revision = Math.max(0, ...existing.map((entry) => entry.revision)) + 1;
    const normalized = Object.freeze({
      organizationId: required(input.organizationId, "organizationId", 128),
      accountId: input.accountId,
      topicKey,
      title: required(input.title, "title", 300),
      observation: required(input.observation, "observation", 10_000),
      rationale: required(input.rationale, "rationale", 10_000),
      scopeDescription: required(input.scopeDescription, "scopeDescription", 2_000),
      keywords: Object.freeze(unique((input.keywords ?? []).map(normalizeKeyword)).sort()),
      sourceRefs: Object.freeze(unique(input.sourceRefs).sort()),
      confidence: input.confidence,
      verifiedOutcome: input.verifiedOutcome,
      status:
        reconciliation.status === "conflicts"
          ? ("conflicted" as const)
          : input.sourceRefs.length === 0
            ? ("needs-review" as const)
            : ("active" as const),
      revision,
      supersedesId: input.supersedesId ?? null,
      conflictsWithIds: Object.freeze(
        reconciliation.status === "conflicts" ? reconciliation.relatedIds : [],
      ),
      createdAt: now,
      expiresAt: input.expiresAt ?? null,
    });
    if (normalized.sourceRefs.length === 0) {
      throw new Error("Semantic memory requires provenance references.");
    }
    const entry = Object.freeze({
      id: this.ids.next("semantic-memory"),
      ...normalized,
      contentHash: hashJson(normalized),
    } satisfies SemanticMemoryEntry);
    if (entry.supersedesId) {
      const target = existing.find((candidate) => candidate.id === entry.supersedesId);
      if (!target) throw new Error("Superseded semantic memory entry was not found.");
      await this.repository.updateSemanticMemory(
        Object.freeze({ ...target, status: "superseded" }),
      );
    }
    await this.repository.saveSemanticMemory(entry);
    return entry;
  }

  async retrieve(input: {
    organizationId: string;
    accountId: string;
    query: string;
    limit?: number;
    requireVerifiedOutcome?: boolean;
  }): Promise<readonly SemanticMemorySearchResult[]> {
    const now = this.clock.now().toISOString();
    const results = await this.repository.searchSemanticMemory({
      organizationId: input.organizationId,
      accountId: input.accountId,
      query: required(input.query, "query", 1_000),
      limit: bounded(input.limit ?? 20),
    });
    return Object.freeze(
      results.filter((result) =>
        decideSemanticMemoryAdmission({
          entry: result.entry,
          organizationId: input.organizationId,
          accountId: input.accountId,
          now,
          requireVerifiedOutcome: input.requireVerifiedOutcome ?? false,
        }).admitted,
      ),
    );
  }

  history(input: { organizationId: string; accountId: string; topicKey: string; limit?: number }) {
    return this.repository.listSemanticMemory({
      organizationId: input.organizationId,
      accountId: input.accountId,
      topicKey: normalizeTopic(input.topicKey),
      limit: bounded(input.limit ?? 100),
    });
  }
}

function assertProcessing(message: AgentMessage): void {
  if (message.status !== "processing" || !message.leaseOwner || !message.leaseUntil) {
    throw new Error(`Agent message ${message.id} is not leased for processing.`);
  }
}

function required(value: string, field: string, maximum: number): string {
  const normalized = value.replace(/[\r\n\t]+/g, " ").trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized.slice(0, maximum);
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be positive.`);
  return value;
}

function bounded(value: number): number {
  return Math.min(100, positive(value, "limit"));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => required(value, "reference", 512)))];
}

function normalizeTopic(value: string): string {
  return required(value, "topicKey", 256).toLowerCase().replace(/[^a-z0-9._:-]+/g, "-");
}

function normalizeKeyword(value: string): string {
  return required(value, "keyword", 100).toLowerCase();
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown collaboration failure")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}
