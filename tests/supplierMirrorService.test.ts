import { describe, expect, it } from "vitest";
import { SupplierMirrorService, type SupplierMirrorObservation } from "@eauto/application";

const observation: SupplierMirrorObservation = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  listingId: "MLC123",
  supplierSourceId: "supplier-1",
  sourceType: "online",
  stockQuantity: 5,
  unitCostMinor: 5_000,
  syncSucceeded: true,
  stockEvidence: Object.freeze({
    id: "stock-evidence-1",
    source: "supplier-api",
    observedAt: "2026-07-27T12:00:00.000Z",
    contentHash: "a".repeat(64),
  }),
  costEvidence: Object.freeze({
    id: "cost-evidence-1",
    source: "supplier-api",
    observedAt: "2026-07-27T12:00:00.000Z",
    contentHash: "b".repeat(64),
  }),
});

describe("SupplierMirrorService", () => {
  it("records a valid evidence-backed observation", async () => {
    const recorded: SupplierMirrorObservation[] = [];
    const service = new SupplierMirrorService({
      record: (value) => {
        recorded.push(value);
        return Promise.resolve("recorded" as const);
      },
    });

    await expect(service.recordObservation(observation)).resolves.toBe("recorded");
    expect(recorded).toEqual([observation]);
  });

  it("requires cost evidence when a unit cost is supplied", async () => {
    const service = new SupplierMirrorService({ record: () => Promise.resolve("recorded") });

    await expect(
      service.recordObservation({ ...observation, costEvidence: null }),
    ).rejects.toThrow(/costEvidence is required/);
  });

  it("rejects unsafe negative stock before reaching infrastructure", async () => {
    let called = false;
    const service = new SupplierMirrorService({
      record: () => {
        called = true;
        return Promise.resolve("recorded");
      },
    });

    await expect(
      service.recordObservation({ ...observation, stockQuantity: -1 }),
    ).rejects.toThrow(/stockQuantity/);
    expect(called).toBe(false);
  });
});
