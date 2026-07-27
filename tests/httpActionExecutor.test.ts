import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusinessAction } from "@eauto/domain";
import {
  DisabledActionExecutor,
  HttpActionExecutor,
} from "../packages/infrastructure/src/httpActionExecutor.js";

const action: BusinessAction = Object.freeze({
  id: "action_price_1",
  accountId: "plasticov",
  kind: "price.update",
  target: "MLC123",
  exactChanges: Object.freeze([{ field: "price", from: 10_000, to: 11_000 }]),
  rationale: "Restore target margin.",
  risk: "medium",
  status: "executing",
  evidenceBundle: Object.freeze({
    id: "evidence_1",
    accountId: "plasticov",
    references: Object.freeze([
      Object.freeze({
        id: "reference_1",
        source: "mercadolibre-listing",
        sourceRecordId: "MLC123",
        observedAt: "2026-07-27T00:00:00.000Z",
        freshness: "fresh",
        confidence: "high",
        contentHash: "a".repeat(64),
      }),
    ]),
    complete: true,
    missingInputs: Object.freeze([]),
  }),
  policyVersion: "pricing-v1",
  expiresAt: "2026-07-28T00:00:00.000Z",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpActionExecutor", () => {
  it("executes and verifies through separate allowlisted endpoints", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ remoteOperationId: "remote-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ verified: true, observedState: { price: 11_000 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const executor = new HttpActionExecutor(
      {
        "price.update": {
          executeUrl: "https://actions.example.com/v1/execute",
          verifyUrl: "https://actions.example.com/v1/verify",
        },
      },
      {
        apiKey: "provider-secret",
        timeoutMs: 5_000,
        maximumResponseBytes: 100_000,
        providerName: "test-actions",
      },
    );

    const executed = await executor.execute(action);
    const verified = await executor.verify(action);

    expect(executed.providerReceipt).toMatchObject({
      provider: "test-actions",
      actionId: action.id,
      response: { remoteOperationId: "remote-1" },
    });
    expect(verified).toEqual({ verified: true, observedState: { price: 11_000 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://actions.example.com/v1/execute");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://actions.example.com/v1/verify");
    const executeHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(executeHeaders.get("authorization")).toBe("Bearer provider-secret");
    expect(executeHeaders.get("idempotency-key")).toBe(`${action.id}:execute`);
  });

  it("fails closed for action kinds without an allowlisted route", async () => {
    const executor = new HttpActionExecutor(
      {},
      {
        apiKey: "provider-secret",
        timeoutMs: 5_000,
        maximumResponseBytes: 100_000,
        providerName: "test-actions",
      },
    );

    await expect(executor.execute(action)).rejects.toThrow(/No allowlisted action provider route/);
  });

  it("does not simulate when execution is disabled", async () => {
    await expect(new DisabledActionExecutor().execute(action)).rejects.toThrow(
      /External action execution is disabled/,
    );
  });
});
