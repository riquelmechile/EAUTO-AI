import { describe, expect, it } from "vitest";
import { SupplierMirrorService } from "@eauto/application";
import type { RecordedSupplierProduct, SupplierProductObservation } from "@eauto/domain";

const observation: SupplierProductObservation = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  supplierSourceId: "supplier-1",
  sourceType: "online",
  sku: "SKU-1",
  name: "Supplier product",
  stockQuantity: 8,
  unitCostMinor: 5_000,
  syncSucceeded: true,
  observedAt: "2026-07-27T12:00:00.000Z",
  evidence: Object.freeze({
    id: "supplier-observation-1",
    source: "supplier",
    observedAt: "2026-07-27T12:00:00.000Z",
    contentHash: "a".repeat(64),
  }),
});

const product: RecordedSupplierProduct = Object.freeze({
  organizationId: observation.organizationId,
  accountId: observation.accountId,
  supplierSourceId: observation.supplierSourceId,
  sourceType: observation.sourceType,
  sku: observation.sku,
  name: observation.name,
  previousStock: observation.stockQuantity,
  currentStock: observation.stockQuantity,
  previousUnitCostMinor: observation.unitCostMinor,
  currentUnitCostMinor: observation.unitCostMinor,
  consecutiveSuccessfulSyncs: 1,
  syncSucceeded: true,
  observedAt: observation.observedAt,
  evidence: observation.evidence,
});

describe("SupplierMirrorService", () => {
  it("validates and records an authoritative supplier observation", async () => {
    const received: SupplierProductObservation[] = [];
    const service = new SupplierMirrorService({
      record: (input) => {
        received.push(input);
        return Promise.resolve({ recorded: true, product });
      },
    });

    const result = await service.recordObservation(observation);

    expect(result).toEqual({ recorded: true, product });
    expect(received).toEqual([observation]);
  });

  it("rejects mismatched observation and evidence timestamps before persistence", () => {
    let called = false;
    const service = new SupplierMirrorService({
      record: () => {
        called = true;
        return Promise.resolve({ recorded: true, product });
      },
    });

    expect(() =>
      service.recordObservation({
        ...observation,
        evidence: { ...observation.evidence, observedAt: "2026-07-27T11:00:00.000Z" },
      }),
    ).toThrow(/timestamps must match/);
    expect(called).toBe(false);
  });
});
