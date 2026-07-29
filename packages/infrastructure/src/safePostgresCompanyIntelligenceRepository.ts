import type { Pool } from "pg";
import type { SemanticMemoryEntry } from "@eauto/domain";
import { PostgresCompanyIntelligenceRepository as BasePostgresCompanyIntelligenceRepository } from "./postgresCompanyIntelligenceRepository.js";

export class PostgresCompanyIntelligenceRepository extends BasePostgresCompanyIntelligenceRepository {
  constructor(private readonly semanticPool: Pool) {
    super(semanticPool);
  }

  override async saveSemanticMemory(entry: SemanticMemoryEntry): Promise<void> {
    await this.semanticPool.query(
      `INSERT INTO semantic_memory_entries
       (id,organization_id,account_id,topic_key,title,observation,rationale,scope_description,
        keywords,status,revision,verified_outcome,expires_at,content_hash,payload_json,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
       ON CONFLICT DO NOTHING`,
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
}
