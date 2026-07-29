import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { AgentMessageBusService, EvidenceResponseRouter } from "@eauto/application";
import { PostgresCompanyIntelligenceRepository } from "@eauto/infrastructure";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the idempotency collision smoke.");

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const suffix = randomUUID().replaceAll("-", "");
const organizationId = `idempotency-org-${suffix}`;
const accountId = `idempotency-account-${suffix}`;
const clock = { now: () => new Date("2026-07-29T03:00:00.000Z") };
let sequence = 0;
const ids = { next: (prefix) => `${prefix}-${suffix}-${++sequence}` };
const repository = new PostgresCompanyIntelligenceRepository(pool);

try {
  await pool.query(`INSERT INTO organizations (id,name) VALUES ($1,$2)`, [
    organizationId,
    "Idempotency Collision Smoke",
  ]);
  await pool.query(
    `INSERT INTO commerce_accounts
     (id,organization_id,name,channel,market,minimum_margin_bps,autonomy_level)
     VALUES ($1,$2,$3,'mercadolibre','MLC',3500,'ask')`,
    [accountId, organizationId, accountId],
  );

  const bus = new AgentMessageBusService(repository, clock, ids);
  const messageInput = {
    idempotencyKey: `message-${suffix}`,
    organizationId,
    accountId,
    senderAgentId: "analytics",
    recipientAgentId: "pricing",
    kind: "command",
    subject: "review-margin",
    payload: { listingId: "MLC1" },
    evidenceRefs: ["profitability:1"],
  };
  const firstMessage = await bus.publish(messageInput);
  const duplicateMessage = await bus.publish(messageInput);
  assert(firstMessage.id === duplicateMessage.id, "exact message retry must remain idempotent");
  await assertCollision(
    () => bus.publish({ ...messageInput, payload: { listingId: "MLC2" } }),
    "message payload collision was accepted",
  );

  const responder = {
    id: "catalog-reader",
    subjects: ["catalog"],
    respond: () => Promise.resolve({ documents: [], missingInputs: ["listing-snapshot"] }),
  };
  const router = new EvidenceResponseRouter([responder], repository, clock, ids, {
    workerId: "idempotency-evidence-worker",
    leaseMs: 30_000,
    maximumAttempts: 3,
  });
  const requestInput = {
    idempotencyKey: `evidence-${suffix}`,
    organizationId,
    accountId,
    conversationId: `conversation-${suffix}`,
    correlationId: `correlation-${suffix}`,
    requesterAgentId: "catalog",
    subject: "catalog",
    purpose: "verify listing MLC1",
    requiredKinds: ["listing-snapshot"],
    maximumAgeMs: 900_000,
  };
  const firstRequest = await router.request(requestInput);
  const duplicateRequest = await router.request(requestInput);
  assert(firstRequest.id === duplicateRequest.id, "exact evidence retry must remain idempotent");
  await assertCollision(
    () => router.request({ ...requestInput, purpose: "verify listing MLC2" }),
    "evidence request collision was accepted",
  );

  console.log("IDEMPOTENCY_COLLISION_GUARDS_OK");
} finally {
  await pool
    .query(`DELETE FROM organizations WHERE id=$1`, [organizationId])
    .catch(() => undefined);
  await pool.end();
}

async function assertCollision(operation, message) {
  try {
    await operation();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    assert(/idempotency collision/i.test(text), `unexpected collision error: ${text}`);
    return;
  }
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
