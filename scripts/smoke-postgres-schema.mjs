import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  PostgresActionLifecycleEventHandler,
  PostgresActionRepository,
  PostgresAgentOsRepository,
  PostgresOperationalEvidenceReader,
  PostgresOperationalIntelligenceRepository,
  PostgresOutboxRepository,
  PostgresReceiptRepository,
  PostgresSourceImageUploadRepository,
} from "@eauto/infrastructure";
import { ActionService, OutboxProcessor } from "@eauto/application";

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
const actionId = `audit-action-${suffix}`;
const uploadId = `audit-upload-${suffix}`;
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

  const outboxRepository = new PostgresOutboxRepository(pool);
  const receiptRepository = new PostgresReceiptRepository(pool);
  const actionRepository = new PostgresActionRepository(pool);
  let actionTick = 0;
  const actionClock = { now: () => new Date(now.getTime() + actionTick++ * 1_000) };
  const actionService = new ActionService(
    actionRepository,
    {
      execute: () => Promise.resolve({ providerReceipt: { requestId: `provider-${suffix}` } }),
      verify: () => Promise.resolve({ verified: false, observedState: { status: "unknown" } }),
    },
    actionClock,
    { next: (prefix) => `${prefix}-${suffix}-${actionTick++}` },
  );
  const actionDraft = Object.freeze({
    id: actionId,
    accountId,
    kind: "listing.update",
    target: `MLC-${suffix}`,
    exactChanges: Object.freeze([{ field: "title", from: "old", to: "new" }]),
    rationale: "Schema smoke action",
    risk: "low",
    status: "draft",
    evidenceBundle: Object.freeze({
      id: packId,
      accountId,
      references: Object.freeze(evidence.documents.map((document) => document.reference)),
      complete: true,
      missingInputs: Object.freeze([]),
    }),
    policyVersion: "audit-policy-v1",
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
  });
  await actionService.propose(actionDraft, "audit-agent");
  const reviewResults = await Promise.allSettled([
    actionService.markReviewed(actionId, "audit-reviewer-a"),
    actionService.markReviewed(actionId, "audit-reviewer-b"),
  ]);
  if (reviewResults.filter((result) => result.status === "fulfilled").length !== 1) {
    throw new Error("Concurrent action review was not compare-and-set protected.");
  }
  await actionService.approve(actionId, "audit-owner");
  await actionService.execute(actionId, "audit-owner").catch(() => undefined);
  const uncertainAction = await actionRepository.get(actionId);
  if (uncertainAction?.status !== "uncertain") {
    throw new Error("Unverified remote action was not marked uncertain.");
  }
  const actionReceipts = await receiptRepository.listForAction(actionId);
  if (actionReceipts.length !== 5 || actionReceipts.at(-1)?.type !== "outcome") {
    throw new Error("Action receipt chain is incomplete.");
  }
  if (
    actionReceipts.some((receipt, index) =>
      index === 0
        ? receipt.previousReceiptHash !== null
        : receipt.previousReceiptHash !== actionReceipts[index - 1]?.chainHash,
    )
  ) {
    throw new Error("Action receipt chain is not linear.");
  }

  const lifecycle = new PostgresActionLifecycleEventHandler(pool);
  const lifecycleProcessor = new OutboxProcessor(
    outboxRepository,
    {
      "action.proposed": lifecycle.handle,
      "action.reviewed": lifecycle.handle,
      "action.approved": lifecycle.handle,
      "action.execution.started": lifecycle.handle,
      "action.executed": lifecycle.handle,
      "action.verified": lifecycle.handle,
      "action.failed": lifecycle.handle,
      "action.uncertain": lifecycle.handle,
    },
    {
      workerId: `audit-worker-${suffix}`,
      leaseMs: 30_000,
      maxAttempts: 3,
      baseRetryMs: 100,
      maxRetryMs: 1_000,
      now: actionClock.now,
    },
  );
  let delivered = 0;
  for (;;) {
    const result = await lifecycleProcessor.runOnce(100);
    delivered += result.processed;
    if (result.claimed === 0) break;
  }
  if (delivered !== 6) throw new Error(`Expected 6 lifecycle deliveries; received ${delivered}.`);
  const deliveryRows = await pool.query(
    `SELECT count(*)::int AS count FROM action_lifecycle_delivery_log WHERE action_id = $1`,
    [actionId],
  );
  if (deliveryRows.rows[0]?.count !== 6) {
    throw new Error("Lifecycle deliveries were acknowledged without materialization.");
  }

  await actionService
    .propose(Object.freeze({ ...actionDraft, accountId: "plasticov" }), "audit-agent")
    .then(() => {
      throw new Error("Duplicate action ID overwrote a different account.");
    })
    .catch((error) => {
      if (!String(error).includes("already exists")) throw error;
    });

  const uploadRepository = new PostgresSourceImageUploadRepository(pool);
  const requestedUpload = Object.freeze({
    id: uploadId,
    organizationId,
    accountId,
    objectKey: `source/${organizationId}/${accountId}/${uploadId}.jpg`,
    originalFileName: "audit.jpg",
    contentType: "image/jpeg",
    sizeBytes: 128,
    checksumSha256Base64: "A".repeat(43) + "=",
    status: "requested",
    objectUri: null,
    createdAt: nowIso,
    expiresAt: deadlineAt,
    verifiedAt: null,
    rejectionReason: null,
  });
  await uploadRepository.save(requestedUpload);
  await uploadRepository
    .save(Object.freeze({ ...requestedUpload, accountId: "plasticov" }))
    .then(() => {
      throw new Error("Upload ID was reused across accounts.");
    })
    .catch((error) => {
      if (!String(error).includes("different ownership")) throw error;
    });
  await uploadRepository.save(
    Object.freeze({
      ...requestedUpload,
      status: "verified",
      objectUri: `s3://eauto-content/${requestedUpload.objectKey}`,
      verifiedAt: new Date(now.getTime() + 1_000).toISOString(),
    }),
  );
  await uploadRepository
    .save(Object.freeze({ ...requestedUpload, status: "expired" }))
    .then(() => {
      throw new Error("Terminal upload was transitioned twice.");
    })
    .catch((error) => {
      if (!String(error).includes("transition conflict")) throw error;
    });

  console.log("✓ Postgres migrations, tenant constraints and durable lifecycles verified");
} finally {
  await pool
    .query(`DELETE FROM action_lifecycle_delivery_log WHERE action_id = $1`, [actionId])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM transactional_outbox WHERE aggregate_id = $1`, [actionId])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM verifiable_receipts WHERE action_id = $1`, [actionId])
    .catch(() => undefined);
  await pool.query(`DELETE FROM approvals WHERE action_id = $1`, [actionId]).catch(() => undefined);
  await pool.query(`DELETE FROM business_actions WHERE id = $1`, [actionId]).catch(() => undefined);
  await pool
    .query(`DELETE FROM source_image_uploads WHERE id = $1`, [uploadId])
    .catch(() => undefined);
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
