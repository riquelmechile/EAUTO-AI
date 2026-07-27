import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  PostgresAgentOsRepository,
  PostgresOperationalEvidenceReader,
  PostgresOperationalIntelligenceRepository,
} from "@eauto/infrastructure";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Postgres schema smoke.");

const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID().replaceAll("-", "");
const organizationId = `audit-org-${suffix}`;
const accountId = `audit-account-${suffix}`;
const sessionIdA = `audit-session-a-${suffix}`;
const sessionIdB = `audit-session-b-${suffix}`;
const orderIdA = `audit-order-a-${suffix}`;
const orderIdB = `audit-order-b-${suffix}`;
const packId = `audit-pack-${suffix}`;
const assetId = `audit-asset-${suffix}`;
const now = new Date();
const nowIso = now.toISOString();
const deadlineAt = new Date(now.getTime() + 60_000).toISOString();

try {
  const columns = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'agent_work_sessions'`,
  );
  const names = new Set(columns.rows.map((row) => row.column_name));
  for (const required of [
    "organization_id",
    "objective_id",
    "idempotency_key",
    "deadline_at",
    "created_at",
    "updated_at",
    "payload_json",
  ]) {
    if (!names.has(required)) throw new Error(`agent_work_sessions is missing ${required}.`);
  }

  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
    organizationId,
    "Audit organization",
  ]);
  await pool.query(
    `INSERT INTO commerce_accounts
      (id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level)
     VALUES ($1,$2,$3,'mercadolibre','MLC',3500,'ask')`,
    [accountId, organizationId, "Audit account"],
  );

  const agentRepository = new PostgresAgentOsRepository(pool);
  const sharedIdempotencyKey = `same-key-${suffix}`;
  const makeSession = ({ id, organizationId: org, accountId: account }) =>
    Object.freeze({
      id,
      organizationId: org,
      accountId: account,
      objectiveId: `objective-${suffix}`,
      agentId: "ceo-agent",
      parentSessionId: null,
      delegationDepth: 0,
      status: "queued",
      requestedAction: "proposal.create",
      expectedEvidenceKinds: Object.freeze([]),
      evidenceRefs: Object.freeze([]),
      outputRefs: Object.freeze([]),
      policyVersion: "audit-v1",
      skillVersions: Object.freeze([]),
      promptPrefixHash: "0".repeat(64),
      idempotencyKey: sharedIdempotencyKey,
      budgetMinorClp: 0,
      spentMinorClp: 0,
      maximumIterations: 1,
      iterationCount: 0,
      startedAt: null,
      heartbeatAt: null,
      deadlineAt,
      completedAt: null,
      failureReason: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

  const plasticov = await agentRepository.createSession(
    makeSession({ id: sessionIdA, organizationId: "maustian", accountId: "plasticov" }),
  );
  const other = await agentRepository.createSession(
    makeSession({ id: sessionIdB, organizationId, accountId }),
  );
  if (plasticov.id === other.id) throw new Error("Session idempotency leaked across scopes.");
  if (
    await agentRepository.getSession({
      organizationId,
      accountId,
      sessionId: plasticov.id,
    })
  ) {
    throw new Error("Cross-scope session lookup returned a foreign session.");
  }

  const intelligenceRepository = new PostgresOperationalIntelligenceRepository(pool);
  const makeOrder = ({ id, organizationId: org, accountId: account }) =>
    Object.freeze({
      id,
      idempotencyKey: sharedIdempotencyKey,
      organizationId: org,
      accountId: account,
      objectiveId: `objective-${suffix}`,
      agentId: "ceo-agent",
      capability: "proposal.create",
      taskClass: "analysis",
      requestedAction: "Audit scoped idempotency",
      evidencePackId: packId,
      memoryRefs: Object.freeze([]),
      signalsHash: "1".repeat(64),
      expectedUtility: 1,
      wakeReason: "manual",
      status: "queued",
      budgetMinorClp: 0,
      budgetMicrosUsd: 0,
      maximumAttempts: 1,
      attempts: 0,
      availableAt: nowIso,
      cooldownUntil: null,
      leaseOwner: null,
      leaseUntil: null,
      sessionId: null,
      outputRefs: Object.freeze([]),
      failureReason: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      completedAt: null,
    });
  const orderA = await intelligenceRepository.enqueueWorkOrder(
    makeOrder({ id: orderIdA, organizationId: "maustian", accountId: "plasticov" }),
  );
  const orderB = await intelligenceRepository.enqueueWorkOrder(
    makeOrder({ id: orderIdB, organizationId, accountId }),
  );
  if (orderA.id === orderB.id) throw new Error("Work-order idempotency leaked across scopes.");
  if (
    await intelligenceRepository.getWorkOrder({
      organizationId,
      accountId,
      id: orderA.id,
    })
  ) {
    throw new Error("Cross-scope work-order lookup returned a foreign order.");
  }

  await pool.query(
    `INSERT INTO content_assets
      (id, account_id, product_id, kind, uri, content_hash, provider, model,
       prompt_version, moderation_status, metadata_json, created_at)
     VALUES ($1,$2,'audit-product','image','s3://audit/object',$3,'audit','audit','v1','approved',$4::jsonb,$5)`,
    [assetId, accountId, "2".repeat(64), JSON.stringify({ source: "audit" }), nowIso],
  );
  const reader = new PostgresOperationalEvidenceReader(pool);
  const evidence = await reader.read({
    organizationId,
    accountId,
    subject: "content",
    asOf: nowIso,
    maximumAgeMs: 60_000,
  });
  if (evidence.documents[0]?.kind !== "content-asset") {
    throw new Error("Operational evidence omitted the exact evidence kind.");
  }

  console.log("✓ Postgres migrations and scoped repositories verified");
} finally {
  await pool.query(`DELETE FROM content_assets WHERE id = $1`, [assetId]).catch(() => undefined);
  await pool
    .query(`DELETE FROM agent_work_orders WHERE id = ANY($1::text[])`, [[orderIdA, orderIdB]])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM agent_work_sessions WHERE id = ANY($1::text[])`, [[sessionIdA, sessionIdB]])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM commerce_accounts WHERE id = $1`, [accountId])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM organizations WHERE id = $1`, [organizationId])
    .catch(() => undefined);
  await pool.end();
}
