import type { Pool } from "pg";
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

export class PostgresCompanyIntelligenceRepository
  implements
    AgentCollaborationRepository,
    AccountBrainRepository,
    SpecialistDaemonRepository,
    SupplyWorkflowRepository,
    ProductLifecycleRepository
{
  constructor(private readonly pool: Pool) {}

  async publishMessage(message: AgentMessage): Promise<AgentMessage> {
    const result = await this.pool.query<{ payload_json: AgentMessage }>(
      `INSERT INTO agent_messages
       (id,idempotency_key,organization_id,account_id,conversation_id,correlation_id,
        recipient_agent_id,status,attempts,maximum_attempts,available_at,lease_owner,
        lease_until,completed_at,content_hash,payload_json,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18)
       ON CONFLICT (organization_id,account_id,idempotency_key)
       DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING payload_json`,
      [
        message.id,
        message.idempotencyKey,
        message.organizationId,
        message.accountId,
        message.conversationId,
        message.correlationId,
        message.recipientAgentId,
        message.status,
        message.attempts,
        message.maximumAttempts,
        message.availableAt,
        message.leaseOwner,
        message.leaseUntil,
        message.completedAt,
        message.contentHash,
        JSON.stringify(message),
        message.createdAt,
        message.updatedAt,
      ],
    );
    return requirePayload(result.rows[0], "agent message");
  }

  async listMessages(input: CollaborationScope & { conversationId?: string; limit: number }) {
    const result = await this.pool.query<{ payload_json: AgentMessage }>(
      `SELECT payload_json FROM agent_messages
       WHERE organization_id = $1 AND account_id = $2
         AND ($3::text IS NULL OR conversation_id = $3)
       ORDER BY created_at DESC LIMIT $4`,
      [input.organizationId, input.accountId, input.conversationId ?? null, input.limit],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async leaseMessages(input: {
    recipientAgentId: string;
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly AgentMessage[]> {
    const result = await this.pool.query<{ payload_json: AgentMessage }>(
      `WITH candidates AS (
         SELECT id FROM agent_messages
         WHERE recipient_agent_id = $1 AND available_at <= $2
           AND (status IN ('queued','failed') OR (status = 'processing' AND lease_until <= $2))
         ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT $3
       ), leased AS (
         UPDATE agent_messages message
         SET status = 'processing', attempts = message.attempts + 1,
             lease_owner = $4, lease_until = $5, updated_at = $2
         FROM candidates WHERE message.id = candidates.id
         RETURNING message.*
       )
       SELECT jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(payload_json, '{status}', '"processing"'::jsonb),
             '{attempts}', to_jsonb(attempts)
           ),
           '{leaseOwner}', to_jsonb(lease_owner)
         ),
         '{leaseUntil}', to_jsonb(lease_until)
       ) AS payload_json FROM leased`,
      [
        input.recipientAgentId,
        input.now.toISOString(),
        input.limit,
        input.owner,
        input.leaseUntil.toISOString(),
      ],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async updateMessage(message: AgentMessage): Promise<void> {
    const result = await this.pool.query(
      `UPDATE agent_messages SET status=$4,available_at=$5,lease_owner=$6,lease_until=$7,
         completed_at=$8,payload_json=$9::jsonb,updated_at=$10
       WHERE id=$1 AND organization_id=$2 AND account_id=$3`,
      [
        message.id,
        message.organizationId,
        message.accountId,
        message.status,
        message.availableAt,
        message.leaseOwner,
        message.leaseUntil,
        message.completedAt,
        JSON.stringify(message),
        message.updatedAt,
      ],
    );
    requireRow(result.rowCount, `Agent message ${message.id}`);
  }

  async enqueueEvidenceRequest(request: EvidenceRequest): Promise<EvidenceRequest> {
    const result = await this.pool.query<{ payload_json: EvidenceRequest }>(
      `INSERT INTO evidence_requests
       (id,idempotency_key,organization_id,account_id,conversation_id,correlation_id,
        responder_id,subject,status,attempts,maximum_attempts,available_at,lease_owner,
        lease_until,completed_at,content_hash,payload_json,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19)
       ON CONFLICT (organization_id,account_id,idempotency_key)
       DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING payload_json`,
      [
        request.id,
        request.idempotencyKey,
        request.organizationId,
        request.accountId,
        request.conversationId,
        request.correlationId,
        request.responderId,
        request.subject,
        request.status,
        request.attempts,
        request.maximumAttempts,
        request.availableAt,
        request.leaseOwner,
        request.leaseUntil,
        request.completedAt,
        request.contentHash,
        JSON.stringify(request),
        request.createdAt,
        request.updatedAt,
      ],
    );
    return requirePayload(result.rows[0], "evidence request");
  }

  async leaseEvidenceRequests(input: {
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly EvidenceRequest[]> {
    const result = await this.pool.query<{ payload_json: EvidenceRequest }>(
      `WITH candidates AS (
         SELECT id FROM evidence_requests
         WHERE available_at <= $1
           AND (status IN ('queued','failed') OR (status = 'processing' AND lease_until <= $1))
         ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT $2
       ), leased AS (
         UPDATE evidence_requests request
         SET status='processing', attempts=request.attempts+1, lease_owner=$3,
             lease_until=$4, updated_at=$1
         FROM candidates WHERE request.id=candidates.id RETURNING request.*
       )
       SELECT jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(payload_json, '{status}', '"processing"'::jsonb),
             '{attempts}', to_jsonb(attempts)
           ),
           '{leaseOwner}', to_jsonb(lease_owner)
         ),
         '{leaseUntil}', to_jsonb(lease_until)
       ) AS payload_json FROM leased`,
      [input.now.toISOString(), input.limit, input.owner, input.leaseUntil.toISOString()],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async updateEvidenceRequest(request: EvidenceRequest): Promise<void> {
    const result = await this.pool.query(
      `UPDATE evidence_requests SET status=$4,available_at=$5,lease_owner=$6,lease_until=$7,
         completed_at=$8,payload_json=$9::jsonb,updated_at=$10
       WHERE id=$1 AND organization_id=$2 AND account_id=$3`,
      [
        request.id,
        request.organizationId,
        request.accountId,
        request.status,
        request.availableAt,
        request.leaseOwner,
        request.leaseUntil,
        request.completedAt,
        JSON.stringify(request),
        request.updatedAt,
      ],
    );
    requireRow(result.rowCount, `Evidence request ${request.id}`);
  }

  async saveEvidenceResponse(response: EvidenceResponse): Promise<void> {
    await this.pool.query(
      `INSERT INTO evidence_responses
       (id,request_id,organization_id,account_id,complete,expires_at,content_hash,payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (request_id) DO NOTHING`,
      [
        response.id,
        response.requestId,
        response.organizationId,
        response.accountId,
        response.complete,
        response.expiresAt,
        response.contentHash,
        JSON.stringify(response),
      ],
    );
  }

  async getEvidenceResponse(input: CollaborationScope & { requestId: string }) {
    const result = await this.pool.query<{ payload_json: EvidenceResponse }>(
      `SELECT payload_json FROM evidence_responses
       WHERE request_id=$1 AND organization_id=$2 AND account_id=$3`,
      [input.requestId, input.organizationId, input.accountId],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async saveSemanticMemory(entry: SemanticMemoryEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO semantic_memory_entries
       (id,organization_id,account_id,topic_key,title,observation,rationale,scope_description,
        keywords,status,revision,verified_outcome,expires_at,content_hash,payload_json,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
       ON CONFLICT (organization_id,coalesce(account_id,'*'),content_hash) DO NOTHING`,
      [
        entry.id,
        entry.organizationId,
        entry.accountId,
        entry.topicKey,
        entry.title,
        entry.observation,
        entry.rationale,
        entry.scopeDescription,
        [...entry.keywords],
        entry.status,
        entry.revision,
        entry.verifiedOutcome,
        entry.expiresAt,
        entry.contentHash,
        JSON.stringify(entry),
        entry.createdAt,
      ],
    );
  }

  async updateSemanticMemory(entry: SemanticMemoryEntry): Promise<void> {
    const result = await this.pool.query(
      `UPDATE semantic_memory_entries SET status=$3,payload_json=$4::jsonb
       WHERE id=$1 AND organization_id=$2`,
      [entry.id, entry.organizationId, entry.status, JSON.stringify(entry)],
    );
    requireRow(result.rowCount, `Semantic memory ${entry.id}`);
  }

  async listSemanticMemory(input: {
    organizationId: string;
    accountId: string;
    topicKey?: string;
    limit: number;
  }) {
    const result = await this.pool.query<{ payload_json: SemanticMemoryEntry }>(
      `SELECT payload_json FROM semantic_memory_entries
       WHERE organization_id=$1 AND (account_id IS NULL OR account_id=$2)
         AND ($3::text IS NULL OR topic_key=$3)
       ORDER BY revision DESC,created_at DESC LIMIT $4`,
      [input.organizationId, input.accountId, input.topicKey ?? null, input.limit],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async searchSemanticMemory(input: {
    organizationId: string;
    accountId: string;
    query: string;
    limit: number;
  }): Promise<readonly SemanticMemorySearchResult[]> {
    const result = await this.pool.query<{
      payload_json: SemanticMemoryEntry;
      rank: number;
      matched_terms: string[];
    }>(
      `WITH query AS (SELECT websearch_to_tsquery('simple',$3) AS value)
       SELECT memory.payload_json,
         ts_rank_cd(memory.search_document,query.value)::float8 AS rank,
         ARRAY(SELECT term FROM unnest(regexp_split_to_array(lower($3),'[^[:alnum:]_.:-]+')) term
               WHERE length(term)>1 AND memory.search_document @@ plainto_tsquery('simple',term)) AS matched_terms
       FROM semantic_memory_entries memory,query
       WHERE memory.organization_id=$1 AND (memory.account_id IS NULL OR memory.account_id=$2)
         AND memory.search_document @@ query.value
       ORDER BY rank DESC,memory.revision DESC,memory.created_at DESC LIMIT $4`,
      [input.organizationId, input.accountId, input.query, input.limit],
    );
    return result.rows.map((row) =>
      Object.freeze({
        entry: row.payload_json,
        rank: row.rank,
        matchedTerms: Object.freeze(row.matched_terms),
      }),
    );
  }

  async saveAccountBrain(snapshot: AccountBrainSnapshot): Promise<void> {
    await this.pool.query(
      `INSERT INTO account_brain_snapshots
       (id,organization_id,account_id,complete,overall_score_bps,generated_at,content_hash,payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (organization_id,account_id,content_hash) DO NOTHING`,
      [
        snapshot.id,
        snapshot.organizationId,
        snapshot.accountId,
        snapshot.complete,
        snapshot.overallScoreBps,
        snapshot.generatedAt,
        snapshot.contentHash,
        JSON.stringify(snapshot),
      ],
    );
  }

  async latestAccountBrain(input: { organizationId: string; accountId: string }) {
    const result = await this.pool.query<{ payload_json: AccountBrainSnapshot }>(
      `SELECT payload_json FROM account_brain_snapshots
       WHERE organization_id=$1 AND account_id=$2 ORDER BY generated_at DESC LIMIT 1`,
      [input.organizationId, input.accountId],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async ensureStates(input: {
    organizationId: string;
    accountId: string;
    definitions: readonly SpecialistDaemonDefinition[];
    now: string;
  }): Promise<void> {
    for (const definition of input.definitions) {
      const state: SpecialistDaemonState = Object.freeze({
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
      });
      await this.pool.query(
        `INSERT INTO specialist_daemon_states
         (organization_id,account_id,daemon_id,enabled,next_run_at,lease_owner,lease_until,
          previous_signals_hash,payload_json,updated_at)
         VALUES ($1,$2,$3,true,$4,NULL,NULL,NULL,$5::jsonb,$4)
         ON CONFLICT (organization_id,account_id,daemon_id) DO NOTHING`,
        [input.organizationId, input.accountId, definition.id, input.now, JSON.stringify(state)],
      );
    }
  }

  async leaseDueStates(input: {
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly SpecialistDaemonState[]> {
    const result = await this.pool.query<{ payload_json: SpecialistDaemonState }>(
      `WITH candidates AS (
         SELECT organization_id,account_id,daemon_id FROM specialist_daemon_states
         WHERE enabled=true AND next_run_at <= $1 AND (lease_until IS NULL OR lease_until <= $1)
         ORDER BY next_run_at ASC FOR UPDATE SKIP LOCKED LIMIT $2
       ), leased AS (
         UPDATE specialist_daemon_states state
         SET lease_owner=$3,lease_until=$4,updated_at=$1
         FROM candidates
         WHERE state.organization_id=candidates.organization_id
           AND state.account_id=candidates.account_id AND state.daemon_id=candidates.daemon_id
         RETURNING state.*
       )
       SELECT jsonb_set(
         jsonb_set(payload_json,'{leaseOwner}',to_jsonb(lease_owner)),
         '{leaseUntil}',to_jsonb(lease_until)
       ) AS payload_json FROM leased`,
      [input.now.toISOString(), input.limit, input.owner, input.leaseUntil.toISOString()],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async saveState(state: SpecialistDaemonState): Promise<void> {
    const result = await this.pool.query(
      `UPDATE specialist_daemon_states SET enabled=$4,next_run_at=$5,lease_owner=$6,lease_until=$7,
         previous_signals_hash=$8,payload_json=$9::jsonb,updated_at=$10
       WHERE organization_id=$1 AND account_id=$2 AND daemon_id=$3`,
      [
        state.organizationId,
        state.accountId,
        state.daemonId,
        state.enabled,
        state.nextRunAt,
        state.leaseOwner,
        state.leaseUntil,
        state.previousSignalsHash,
        JSON.stringify(state),
        state.updatedAt,
      ],
    );
    requireRow(result.rowCount, `Daemon state ${state.daemonId}`);
  }

  async saveRun(run: SpecialistDaemonRun): Promise<void> {
    await this.pool.query(
      `INSERT INTO specialist_daemon_runs
       (id,organization_id,account_id,daemon_id,status,started_at,completed_at,content_hash,payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (organization_id,account_id,daemon_id,content_hash) DO NOTHING`,
      [
        run.id,
        run.organizationId,
        run.accountId,
        run.daemonId,
        run.status,
        run.startedAt,
        run.completedAt,
        run.contentHash,
        JSON.stringify(run),
      ],
    );
  }

  async listStates(input: { organizationId: string; accountId: string }) {
    const result = await this.pool.query<{ payload_json: SpecialistDaemonState }>(
      `SELECT payload_json FROM specialist_daemon_states
       WHERE organization_id=$1 AND account_id=$2 ORDER BY daemon_id ASC`,
      [input.organizationId, input.accountId],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async listRuns(input: {
    organizationId: string;
    accountId: string;
    daemonId?: SpecialistDaemonId;
    limit: number;
  }) {
    const result = await this.pool.query<{ payload_json: SpecialistDaemonRun }>(
      `SELECT payload_json FROM specialist_daemon_runs
       WHERE organization_id=$1 AND account_id=$2 AND ($3::text IS NULL OR daemon_id=$3)
       ORDER BY completed_at DESC LIMIT $4`,
      [input.organizationId, input.accountId, input.daemonId ?? null, input.limit],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async saveSupplyWorkflow(run: SupplyWorkflowRun): Promise<SupplyWorkflowRun> {
    const result = await this.pool.query<{ payload_json: SupplyWorkflowRun }>(
      `INSERT INTO supply_workflow_runs
       (id,organization_id,account_id,kind,supplier_id,listing_id,status,dry_run,content_hash,
        payload_json,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9::jsonb,$10,$11)
       ON CONFLICT (organization_id,account_id,content_hash)
       DO UPDATE SET content_hash=EXCLUDED.content_hash RETURNING payload_json`,
      [
        run.id,
        run.organizationId,
        run.accountId,
        run.kind,
        run.supplierId,
        run.listingId,
        run.status,
        run.contentHash,
        JSON.stringify(run),
        run.createdAt,
        run.updatedAt,
      ],
    );
    return requirePayload(result.rows[0], "supply workflow");
  }

  async getSupplyWorkflow(input: { organizationId: string; accountId: string; id: string }) {
    const result = await this.pool.query<{ payload_json: SupplyWorkflowRun }>(
      `SELECT payload_json FROM supply_workflow_runs
       WHERE id=$1 AND organization_id=$2 AND account_id=$3`,
      [input.id, input.organizationId, input.accountId],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async listSupplyWorkflows(input: { organizationId: string; accountId: string; limit: number }) {
    const result = await this.pool.query<{ payload_json: SupplyWorkflowRun }>(
      `SELECT payload_json FROM supply_workflow_runs
       WHERE organization_id=$1 AND account_id=$2 ORDER BY created_at DESC LIMIT $3`,
      [input.organizationId, input.accountId, input.limit],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async saveProductLifecycle(assessment: ProductLifecycleAssessment): Promise<void> {
    await this.pool.query(
      `INSERT INTO product_lifecycle_assessments
       (organization_id,account_id,listing_id,state,confidence,assessed_at,content_hash,payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        assessment.organizationId,
        assessment.accountId,
        assessment.listingId,
        assessment.state,
        assessment.confidence,
        assessment.assessedAt,
        assessment.contentHash,
        JSON.stringify(assessment),
      ],
    );
  }

  async latestProductLifecycle(input: {
    organizationId: string;
    accountId: string;
    listingId: string;
  }) {
    const result = await this.pool.query<{ payload_json: ProductLifecycleAssessment }>(
      `SELECT payload_json FROM product_lifecycle_assessments
       WHERE organization_id=$1 AND account_id=$2 AND listing_id=$3
       ORDER BY assessed_at DESC LIMIT 1`,
      [input.organizationId, input.accountId, input.listingId],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async listProductLifecycle(input: {
    organizationId: string;
    accountId: string;
    state?: ProductLifecycleState;
    limit: number;
  }) {
    const result = await this.pool.query<{ payload_json: ProductLifecycleAssessment }>(
      `SELECT payload_json FROM product_lifecycle_assessments
       WHERE organization_id=$1 AND account_id=$2 AND ($3::text IS NULL OR state=$3)
       ORDER BY assessed_at DESC LIMIT $4`,
      [input.organizationId, input.accountId, input.state ?? null, input.limit],
    );
    return result.rows.map((row) => row.payload_json);
  }
}

function requirePayload<T>(row: Readonly<{ payload_json: T }> | undefined, label: string): T {
  if (!row) throw new Error(`PostgreSQL did not return ${label}.`);
  return row.payload_json;
}

function requireRow(rowCount: number | null, label: string): void {
  if (rowCount !== 1) throw new Error(`${label} was not found in the requested scope.`);
}
