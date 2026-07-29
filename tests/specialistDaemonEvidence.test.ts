import { expect, it } from "vitest";
import {
  SPECIALIST_DAEMON_CATALOG,
  SpecialistDaemonScheduler,
  type GovernedWorkOrderService,
  type OperationalIntelligenceService,
} from "@eauto/application";
import { InMemoryCompanyIntelligenceRepository } from "@eauto/infrastructure";

it("does not queue a specialist when its explicit evidence kinds are missing", async () => {
  const repository = new InMemoryCompanyIntelligenceRepository();
  const clock = { now: () => new Date("2026-07-29T03:00:00.000Z") };
  let sequence = 0;
  let enqueueCalls = 0;
  const intelligence = {
    buildEvidencePack: () =>
      Promise.resolve({
        id: "pack-1",
        organizationId: "maustian",
        accountId: "plasticov",
        purpose: "daemon:economic-ingestion",
        subject: "economic",
        generatedAt: "2026-07-29T03:00:00.000Z",
        expiresAt: "2026-07-29T03:15:00.000Z",
        documents: [
          {
            reference: {
              id: "order:1",
              source: "mercadolibre-order",
              sourceRecordId: "1",
              observedAt: "2026-07-29T02:59:00.000Z",
              freshness: "fresh",
              confidence: "high",
              contentHash: "a".repeat(64),
            },
            subject: "economic",
            kind: "order-snapshot",
            authority: "authoritative",
            expiresAt: "2026-07-29T03:15:00.000Z",
            payload: {},
          },
        ],
        complete: true,
        missingInputs: [],
        contentHash: "b".repeat(64),
      }),
  } as unknown as OperationalIntelligenceService;
  const workOrders = {
    enqueue: () => {
      enqueueCalls += 1;
      throw new Error("work order must not be queued without cost-evidence");
    },
  } as unknown as GovernedWorkOrderService;
  const scheduler = new SpecialistDaemonScheduler(
    SPECIALIST_DAEMON_CATALOG,
    repository,
    { readSignals: () => Promise.resolve([]) },
    intelligence,
    workOrders,
    clock,
    { next: (prefix) => `${prefix}-${++sequence}` },
    { workerId: "daemon-test", leaseMs: 30_000 },
  );

  await scheduler.initialize({ organizationId: "maustian", accountId: "plasticov" });
  const result = await scheduler.runOnce(1);
  const runs = await scheduler.listRuns({
    organizationId: "maustian",
    accountId: "plasticov",
    daemonId: "economic-ingestion",
  });

  expect(result).toMatchObject({ leased: 1, queued: 0, waitingEvidence: 1, failed: 0 });
  expect(enqueueCalls).toBe(0);
  expect(runs[0]).toMatchObject({
    status: "waiting-evidence",
    reason: "missing-evidence:cost-evidence",
  });
});
