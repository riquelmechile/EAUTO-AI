import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  AccountBrainService,
  AgentMessageBusService,
  EvidenceResponseRouter,
  ProductLifecycleService,
  SemanticMemoryService,
  SupplyWorkflowService,
  SPECIALIST_DAEMON_CATALOG,
} from "@eauto/application";
import { PostgresCompanyIntelligenceRepository } from "@eauto/infrastructure";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Gentleman parity smoke.");
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const suffix = randomUUID().replaceAll("-", "");
const organizationId = `gentleman-org-${suffix}`;
const accountId = `gentleman-account-${suffix}`;
const otherAccountId = `gentleman-other-${suffix}`;
const now = new Date("2026-07-28T12:00:00.000Z");
let sequence = 0;
const ids = { next: (prefix) => `${prefix}-${suffix}-${++sequence}` };
const clock = { now: () => now };
const repository = new PostgresCompanyIntelligenceRepository(pool);

try {
  await seedScope();
  const bus = new AgentMessageBusService(repository, clock, ids);
  const first = await bus.publish({
    idempotencyKey: `message-${suffix}`,
    organizationId,
    accountId,
    senderAgentId: "analytics",
    recipientAgentId: "pricing",
    kind: "command",
    subject: "review-margin",
    payload: { listingId: "MLC1" },
    evidenceRefs: ["profitability:1"],
  });
  const duplicate = await bus.publish({
    idempotencyKey: `message-${suffix}`,
    organizationId,
    accountId,
    senderAgentId: "analytics",
    recipientAgentId: "pricing",
    kind: "command",
    subject: "review-margin",
    payload: { listingId: "MLC1" },
    evidenceRefs: ["profitability:1"],
  });
  assert(first.id === duplicate.id, "agent message idempotency failed");
  const lease = await bus.lease({
    recipientAgentId: "pricing",
    owner: "worker-a",
    leaseMs: 30_000,
  });
  assert(lease.length === 1, "message must be leased exactly once");
  const competing = await bus.lease({
    recipientAgentId: "pricing",
    owner: "worker-b",
    leaseMs: 30_000,
  });
  assert(competing.length === 0, "competing worker leased the same message");
  await bus.complete(lease[0]);
  assert((await bus.list({ organizationId, accountId })).length === 1, "message list failed");
  assert(
    (await bus.list({ organizationId, accountId: otherAccountId })).length === 0,
    "message tenant isolation failed",
  );

  const responder = {
    id: "verified-reader",
    subjects: ["catalog"],
    respond: () =>
      Promise.resolve({
        documents: [
          {
            reference: {
              id: "listing:MLC1",
              source: "mercadolibre-listing",
              sourceRecordId: "MLC1",
              observedAt: "2026-07-28T11:59:00.000Z",
              freshness: "fresh",
              confidence: "high",
              contentHash: "a".repeat(64),
            },
            subject: "catalog",
            kind: "listing-snapshot",
            authority: "authoritative",
            expiresAt: "2026-07-28T12:15:00.000Z",
            payload: { itemId: "MLC1" },
          },
        ],
        missingInputs: [],
      }),
  };
  const router = new EvidenceResponseRouter([responder], repository, clock, ids, {
    workerId: "evidence-worker",
    leaseMs: 30_000,
    maximumAttempts: 3,
  });
  const evidenceRequest = await router.request({
    idempotencyKey: `evidence-${suffix}`,
    organizationId,
    accountId,
    conversationId: `conversation-${suffix}`,
    correlationId: `correlation-${suffix}`,
    requesterAgentId: "catalog",
    subject: "catalog",
    purpose: "verify listing",
    requiredKinds: ["listing-snapshot"],
    maximumAgeMs: 900_000,
  });
  const routed = await router.processBatch();
  assert(routed.fulfilled === 1, "evidence response router failed");
  assert(
    (
      await repository.getEvidenceResponse({
        organizationId,
        accountId,
        requestId: evidenceRequest.id,
      })
    )?.complete === true,
    "evidence response was not persisted",
  );

  const memory = new SemanticMemoryService(repository, clock, ids);
  const memoryEntry = await memory.remember({
    organizationId,
    accountId,
    topicKey: "pricing:MLC1",
    title: "Verified margin floor",
    observation: "The owner-approved margin floor is thirty five percent.",
    rationale: "Policy and profitability evidence agree.",
    scopeDescription: "Listing MLC1",
    keywords: ["pricing", "margin"],
    sourceRefs: ["policy:v1", "profitability:1"],
    confidence: "high",
    verifiedOutcome: true,
  });
  const memorySearch = await memory.retrieve({
    organizationId,
    accountId,
    query: "pricing margin",
    requireVerifiedOutcome: true,
  });
  assert(memorySearch[0]?.entry.id === memoryEntry.id, "semantic full-text retrieval failed");
  assert(
    (await memory.retrieve({ organizationId, accountId: otherAccountId, query: "pricing margin" }))
      .length === 0,
    "semantic memory tenant isolation failed",
  );

  const brain = new AccountBrainService(
    repository,
    {
      readDimension: ({ dimension }) =>
        Promise.resolve({
          scoreBps: 8_000,
          evidenceRefs: [`evidence:${dimension}`],
          missingInputs: [],
          findings: [],
        }),
      retrieveMemory: (input) => memory.retrieve(input),
    },
    clock,
    ids,
  );
  const brainSnapshot = await brain.rebuild({ organizationId, accountId, maximumAgeMs: 900_000 });
  assert(brainSnapshot.complete, "Account Brain should be complete in the seeded smoke");
  assert(
    (await brain.latest({ organizationId, accountId }))?.id === brainSnapshot.id,
    "Account Brain latest failed",
  );

  await repository.ensureStates({
    organizationId,
    accountId,
    definitions: SPECIALIST_DAEMON_CATALOG,
    now: now.toISOString(),
  });
  assert(
    (await repository.listStates({ organizationId, accountId })).length === 16,
    "sixteen daemon states were not initialized",
  );
  const daemonLease = await repository.leaseDueStates({
    owner: "daemon-worker-a",
    now,
    leaseUntil: new Date(now.getTime() + 30_000),
    limit: 16,
  });
  assert(daemonLease.length === 16, "all due daemons must be leasable");
  const daemonCompetition = await repository.leaseDueStates({
    owner: "daemon-worker-b",
    now,
    leaseUntil: new Date(now.getTime() + 30_000),
    limit: 16,
  });
  assert(daemonCompetition.length === 0, "daemon lease isolation failed");

  const supply = new SupplyWorkflowService(
    repository,
    {
      read: () =>
        Promise.resolve({
          availableKinds: [
            "supplier-evidence",
            "listing-snapshot",
            "inventory-snapshot",
            "economic-snapshot",
            "policy-version",
          ],
          evidenceRefs: ["supplier:1", "listing:1", "economic:1", "policy:v1"],
          missingInputs: [],
        }),
    },
    clock,
    ids,
  );
  const workflow = await supply.run({
    organizationId,
    accountId,
    kind: "stock.autopause",
    supplierId: "supplier-1",
    listingId: "MLC1",
    requestedBy: "smoke-owner",
    parameters: {
      maximumAgeMs: 900_000,
      stockFloor: 1,
      stockCeiling: null,
      maximumPurchaseQuantity: null,
      maximumUnitCostMinorClp: null,
      reason: "Verified stock below safe floor.",
    },
    evidenceRefs: [],
    dryRun: true,
    idempotencyKey: `supply-${suffix}`,
  });
  assert(
    workflow.status === "proposed" && workflow.dryRun,
    "supply workflow must remain a dry-run proposal",
  );
  assert(
    (await supply.list({ organizationId, accountId })).length === 1,
    "supply workflow list failed",
  );

  const lifecycle = new ProductLifecycleService(
    repository,
    {
      readLifecycleInput: () =>
        Promise.resolve({
          listingActive: true,
          availableQuantity: 5,
          soldUnits30d: 2,
          soldUnits90d: 5,
          visits30d: null,
          lastSaleAt: "2026-07-27T12:00:00.000Z",
          marginBps: 4_000,
          seasonInWindow: null,
          seasonEvidenceConfidence: null,
          evidenceFresh: true,
          evidenceRefs: ["listing:1", "profitability:1"],
        }),
      listListingIds: () => Promise.resolve(["MLC1"]),
    },
    clock,
  );
  const assessment = await lifecycle.assess({ organizationId, accountId, listingId: "MLC1" });
  assert(assessment.state === "active", "lifecycle classification failed");
  assert(
    (await lifecycle.latest({ organizationId, accountId, listingId: "MLC1" }))?.state === "active",
    "lifecycle latest failed",
  );

  console.log("GENTLEMAN_PARITY_POSTGRES_SMOKE_OK");
} finally {
  await cleanup();
  await pool.end();
}

async function seedScope() {
  await pool.query(`INSERT INTO organizations (id,name) VALUES ($1,$2)`, [
    organizationId,
    "Gentleman Smoke",
  ]);
  for (const id of [accountId, otherAccountId]) {
    await pool.query(
      `INSERT INTO commerce_accounts
       (id,organization_id,name,channel,market,minimum_margin_bps,autonomy_level)
       VALUES ($1,$2,$3,'mercadolibre','MLC',3500,'ask')`,
      [id, organizationId, id],
    );
  }
}

async function cleanup() {
  await pool
    .query(`DELETE FROM organizations WHERE id=$1`, [organizationId])
    .catch(() => undefined);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
