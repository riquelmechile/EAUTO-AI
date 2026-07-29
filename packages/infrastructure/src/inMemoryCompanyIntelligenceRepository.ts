import type {
  AccountBrainSnapshot,
  AgentMessage,
  EvidenceRequest,
  EvidenceResponse,
  ProductLifecycleAssessment,
  ProductLifecycleState,
  SemanticMemoryEntry,
  SemanticMemorySearchResult,
  SpecialistDaemonDefinition,
  SpecialistDaemonId,
  SpecialistDaemonRun,
  SpecialistDaemonState,
  SupplyWorkflowRun,
} from "@eauto/domain";
import type {
  AccountBrainRepository,
  AgentCollaborationRepository,
  CollaborationScope,
  ProductLifecycleRepository,
  SpecialistDaemonRepository,
  SupplyWorkflowRepository,
} from "@eauto/application";

export class InMemoryCompanyIntelligenceRepository
  implements
    AgentCollaborationRepository,
    AccountBrainRepository,
    SpecialistDaemonRepository,
    SupplyWorkflowRepository,
    ProductLifecycleRepository
{
  private readonly messages = new Map<string, AgentMessage>();
  private readonly messageIdempotency = new Map<string, string>();
  private readonly evidenceRequests = new Map<string, EvidenceRequest>();
  private readonly evidenceRequestIdempotency = new Map<string, string>();
  private readonly evidenceResponses = new Map<string, EvidenceResponse>();
  private readonly semanticMemory = new Map<string, SemanticMemoryEntry>();
  private readonly brains = new Map<string, AccountBrainSnapshot>();
  private readonly daemonStates = new Map<string, SpecialistDaemonState>();
  private readonly daemonRuns = new Map<string, SpecialistDaemonRun>();
  private readonly supplyRuns = new Map<string, SupplyWorkflowRun>();
  private readonly lifecycle = new Map<string, ProductLifecycleAssessment>();

  publishMessage(message: AgentMessage): Promise<AgentMessage> {
    const key = scopedKey(message, message.idempotencyKey);
    const existingId = this.messageIdempotency.get(key);
    if (existingId) return Promise.resolve(this.messages.get(existingId) ?? message);
    this.messages.set(message.id, message);
    this.messageIdempotency.set(key, message.id);
    return Promise.resolve(message);
  }

  listMessages(
    input: CollaborationScope & { conversationId?: string; limit: number },
  ): Promise<readonly AgentMessage[]> {
    return Promise.resolve(
      descending(
        [...this.messages.values()].filter(
          (message) =>
            sameScope(message, input) &&
            (!input.conversationId || message.conversationId === input.conversationId),
        ),
        "createdAt",
      ).slice(0, input.limit),
    );
  }

  leaseMessages(input: {
    recipientAgentId: string;
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly AgentMessage[]> {
    const nowMs = input.now.getTime();
    const leased = [...this.messages.values()]
      .filter(
        (message) =>
          message.recipientAgentId === input.recipientAgentId &&
          (message.status === "queued" || message.status === "failed") &&
          Date.parse(message.availableAt) <= nowMs &&
          (message.leaseUntil === null || Date.parse(message.leaseUntil) <= nowMs),
      )
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .slice(0, input.limit)
      .map((message) => {
        const next = Object.freeze({
          ...message,
          status: "processing" as const,
          attempts: message.attempts + 1,
          leaseOwner: input.owner,
          leaseUntil: input.leaseUntil.toISOString(),
          updatedAt: input.now.toISOString(),
        });
        this.messages.set(next.id, next);
        return next;
      });
    return Promise.resolve(Object.freeze(leased));
  }

  updateMessage(message: AgentMessage): Promise<void> {
    const current = this.messages.get(message.id);
    if (!current || !sameScope(current, message))
      throw new Error(`Agent message ${message.id} not found.`);
    this.messages.set(message.id, message);
    return Promise.resolve();
  }

  enqueueEvidenceRequest(request: EvidenceRequest): Promise<EvidenceRequest> {
    const key = scopedKey(request, request.idempotencyKey);
    const existingId = this.evidenceRequestIdempotency.get(key);
    if (existingId) return Promise.resolve(this.evidenceRequests.get(existingId) ?? request);
    this.evidenceRequests.set(request.id, request);
    this.evidenceRequestIdempotency.set(key, request.id);
    return Promise.resolve(request);
  }

  leaseEvidenceRequests(input: {
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly EvidenceRequest[]> {
    const nowMs = input.now.getTime();
    const leased = [...this.evidenceRequests.values()]
      .filter(
        (request) =>
          (request.status === "queued" || request.status === "failed") &&
          Date.parse(request.availableAt) <= nowMs &&
          (request.leaseUntil === null || Date.parse(request.leaseUntil) <= nowMs),
      )
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .slice(0, input.limit)
      .map((request) => {
        const next = Object.freeze({
          ...request,
          status: "processing" as const,
          attempts: request.attempts + 1,
          leaseOwner: input.owner,
          leaseUntil: input.leaseUntil.toISOString(),
          updatedAt: input.now.toISOString(),
        });
        this.evidenceRequests.set(next.id, next);
        return next;
      });
    return Promise.resolve(Object.freeze(leased));
  }

  updateEvidenceRequest(request: EvidenceRequest): Promise<void> {
    const current = this.evidenceRequests.get(request.id);
    if (!current || !sameScope(current, request)) {
      throw new Error(`Evidence request ${request.id} not found.`);
    }
    this.evidenceRequests.set(request.id, request);
    return Promise.resolve();
  }

  saveEvidenceResponse(response: EvidenceResponse): Promise<void> {
    const current = this.evidenceResponses.get(response.requestId);
    if (current && current.contentHash !== response.contentHash) {
      throw new Error(`Evidence response for ${response.requestId} is immutable.`);
    }
    this.evidenceResponses.set(response.requestId, response);
    return Promise.resolve();
  }

  getEvidenceResponse(
    input: CollaborationScope & { requestId: string },
  ): Promise<EvidenceResponse | null> {
    const response = this.evidenceResponses.get(input.requestId);
    return Promise.resolve(response && sameScope(response, input) ? response : null);
  }

  saveSemanticMemory(entry: SemanticMemoryEntry): Promise<void> {
    const current = this.semanticMemory.get(entry.id);
    if (current && current.contentHash !== entry.contentHash) {
      throw new Error(`Semantic memory ${entry.id} is immutable.`);
    }
    this.semanticMemory.set(entry.id, entry);
    return Promise.resolve();
  }

  updateSemanticMemory(entry: SemanticMemoryEntry): Promise<void> {
    const current = this.semanticMemory.get(entry.id);
    if (!current || current.organizationId !== entry.organizationId) {
      throw new Error(`Semantic memory ${entry.id} not found.`);
    }
    this.semanticMemory.set(entry.id, entry);
    return Promise.resolve();
  }

  listSemanticMemory(input: {
    organizationId: string;
    accountId: string;
    topicKey?: string;
    limit: number;
  }): Promise<readonly SemanticMemoryEntry[]> {
    return Promise.resolve(
      descending(
        [...this.semanticMemory.values()].filter(
          (entry) =>
            entry.organizationId === input.organizationId &&
            (entry.accountId === null || entry.accountId === input.accountId) &&
            (!input.topicKey || entry.topicKey === input.topicKey),
        ),
        "createdAt",
      ).slice(0, input.limit),
    );
  }

  searchSemanticMemory(input: {
    organizationId: string;
    accountId: string;
    query: string;
    limit: number;
  }): Promise<readonly SemanticMemorySearchResult[]> {
    const terms = tokenize(input.query);
    const results = [...this.semanticMemory.values()]
      .filter(
        (entry) =>
          entry.organizationId === input.organizationId &&
          (entry.accountId === null || entry.accountId === input.accountId),
      )
      .map((entry) => {
        const searchable = tokenize(
          [
            entry.topicKey,
            entry.title,
            entry.observation,
            entry.rationale,
            entry.scopeDescription,
            ...entry.keywords,
          ].join(" "),
        );
        const matchedTerms = Object.freeze(terms.filter((term) => searchable.includes(term)));
        return Object.freeze({
          entry,
          rank: terms.length === 0 ? 0 : matchedTerms.length / terms.length,
          matchedTerms,
        });
      })
      .filter((result) => result.rank > 0)
      .sort((left, right) => right.rank - left.rank || right.entry.revision - left.entry.revision)
      .slice(0, input.limit);
    return Promise.resolve(Object.freeze(results));
  }

  saveAccountBrain(snapshot: AccountBrainSnapshot): Promise<void> {
    this.brains.set(snapshot.id, snapshot);
    return Promise.resolve();
  }

  latestAccountBrain(input: {
    organizationId: string;
    accountId: string;
  }): Promise<AccountBrainSnapshot | null> {
    return Promise.resolve(
      descending(
        [...this.brains.values()].filter((snapshot) => sameScope(snapshot, input)),
        "generatedAt",
      )[0] ?? null,
    );
  }

  ensureStates(input: {
    organizationId: string;
    accountId: string;
    definitions: readonly SpecialistDaemonDefinition[];
    now: string;
  }): Promise<void> {
    for (const definition of input.definitions) {
      const key = daemonKey(input.organizationId, input.accountId, definition.id);
      if (this.daemonStates.has(key)) continue;
      this.daemonStates.set(
        key,
        Object.freeze({
          organizationId: input.organizationId,
          accountId: input.accountId,
          daemonId: definition.id,
          enabled: true,
          nextRunAt: input.now,
          leaseOwner: null,
          leaseUntil: null,
          previousSignalsHash: null,
          lastEvidencePackId: null,
          lastWorkOrderId: null,
          lastStatus: "never",
          lastError: null,
          lastRunAt: null,
          updatedAt: input.now,
        }),
      );
    }
    return Promise.resolve();
  }

  leaseDueStates(input: {
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly SpecialistDaemonState[]> {
    const nowMs = input.now.getTime();
    const leased = [...this.daemonStates.entries()]
      .filter(
        ([, state]) =>
          state.enabled &&
          Date.parse(state.nextRunAt) <= nowMs &&
          (state.leaseUntil === null || Date.parse(state.leaseUntil) <= nowMs),
      )
      .sort(([, left], [, right]) => Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt))
      .slice(0, input.limit)
      .map(([key, state]) => {
        const next = Object.freeze({
          ...state,
          leaseOwner: input.owner,
          leaseUntil: input.leaseUntil.toISOString(),
          updatedAt: input.now.toISOString(),
        });
        this.daemonStates.set(key, next);
        return next;
      });
    return Promise.resolve(Object.freeze(leased));
  }

  saveState(state: SpecialistDaemonState): Promise<void> {
    const key = daemonKey(state.organizationId, state.accountId, state.daemonId);
    if (!this.daemonStates.has(key)) throw new Error(`Daemon state ${state.daemonId} not found.`);
    this.daemonStates.set(key, state);
    return Promise.resolve();
  }

  saveRun(run: SpecialistDaemonRun): Promise<void> {
    this.daemonRuns.set(run.id, run);
    return Promise.resolve();
  }

  listStates(input: {
    organizationId: string;
    accountId: string;
  }): Promise<readonly SpecialistDaemonState[]> {
    return Promise.resolve(
      [...this.daemonStates.values()]
        .filter((state) => sameScope(state, input))
        .sort((left, right) => left.daemonId.localeCompare(right.daemonId)),
    );
  }

  listRuns(input: {
    organizationId: string;
    accountId: string;
    daemonId?: SpecialistDaemonId;
    limit: number;
  }): Promise<readonly SpecialistDaemonRun[]> {
    return Promise.resolve(
      descending(
        [...this.daemonRuns.values()].filter(
          (run) => sameScope(run, input) && (!input.daemonId || run.daemonId === input.daemonId),
        ),
        "completedAt",
      ).slice(0, input.limit),
    );
  }

  saveSupplyWorkflow(run: SupplyWorkflowRun): Promise<SupplyWorkflowRun> {
    const existing = [...this.supplyRuns.values()].find(
      (candidate) => sameScope(candidate, run) && candidate.contentHash === run.contentHash,
    );
    if (existing) return Promise.resolve(existing);
    this.supplyRuns.set(run.id, run);
    return Promise.resolve(run);
  }

  getSupplyWorkflow(input: {
    organizationId: string;
    accountId: string;
    id: string;
  }): Promise<SupplyWorkflowRun | null> {
    const run = this.supplyRuns.get(input.id);
    return Promise.resolve(run && sameScope(run, input) ? run : null);
  }

  listSupplyWorkflows(input: {
    organizationId: string;
    accountId: string;
    limit: number;
  }): Promise<readonly SupplyWorkflowRun[]> {
    return Promise.resolve(
      descending(
        [...this.supplyRuns.values()].filter((run) => sameScope(run, input)),
        "createdAt",
      ).slice(0, input.limit),
    );
  }

  saveProductLifecycle(assessment: ProductLifecycleAssessment): Promise<void> {
    this.lifecycle.set(
      `${assessment.organizationId}\u0000${assessment.accountId}\u0000${assessment.listingId}\u0000${assessment.contentHash}`,
      assessment,
    );
    return Promise.resolve();
  }

  latestProductLifecycle(input: {
    organizationId: string;
    accountId: string;
    listingId: string;
  }): Promise<ProductLifecycleAssessment | null> {
    return Promise.resolve(
      descending(
        [...this.lifecycle.values()].filter(
          (assessment) => sameScope(assessment, input) && assessment.listingId === input.listingId,
        ),
        "assessedAt",
      )[0] ?? null,
    );
  }

  listProductLifecycle(input: {
    organizationId: string;
    accountId: string;
    state?: ProductLifecycleState;
    limit: number;
  }): Promise<readonly ProductLifecycleAssessment[]> {
    return Promise.resolve(
      descending(
        [...this.lifecycle.values()].filter(
          (assessment) =>
            sameScope(assessment, input) && (!input.state || assessment.state === input.state),
        ),
        "assessedAt",
      ).slice(0, input.limit),
    );
  }
}

function sameScope(
  left: Readonly<{ organizationId: string; accountId: string }>,
  right: Readonly<{ organizationId: string; accountId: string }>,
): boolean {
  return left.organizationId === right.organizationId && left.accountId === right.accountId;
}

function scopedKey(
  scope: Readonly<{ organizationId: string; accountId: string }>,
  value: string,
): string {
  return `${scope.organizationId}\u0000${scope.accountId}\u0000${value}`;
}

function daemonKey(
  organizationId: string,
  accountId: string,
  daemonId: SpecialistDaemonId,
): string {
  return `${organizationId}\u0000${accountId}\u0000${daemonId}`;
}

function descending<T extends Record<K, string>, K extends keyof T>(values: T[], key: K): T[] {
  return values.sort((left, right) => Date.parse(right[key]) - Date.parse(left[key]));
}

function tokenize(value: string): readonly string[] {
  return Object.freeze([
    ...new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9áéíóúüñ._:-]+/u)
        .filter((term) => term.length > 1),
    ),
  ]);
}
