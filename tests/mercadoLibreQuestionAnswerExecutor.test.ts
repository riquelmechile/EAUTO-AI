import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusinessAction } from "@eauto/domain";
import { MercadoLibreQuestionAnswerExecutor } from "../packages/infrastructure/src/mercadoLibreQuestionAnswerExecutor.js";

const baseAction: BusinessAction = Object.freeze({
  id: "action_question_1",
  accountId: "plasticov",
  kind: "question.answer",
  target: "3957150025",
  exactChanges: Object.freeze([
    Object.freeze({ field: "answer.text", from: null, to: "Sí, tenemos stock disponible." }),
  ]),
  rationale: "Responder una consulta comercial aprobada por el operador.",
  risk: "low",
  status: "executing",
  evidenceBundle: Object.freeze({
    id: "evidence_question_1",
    accountId: "plasticov",
    references: Object.freeze([
      Object.freeze({
        id: "question_snapshot_1",
        source: "mercadolibre-question",
        sourceRecordId: "3957150025",
        observedAt: "2026-07-28T00:00:00.000Z",
        freshness: "fresh",
        confidence: "high",
        contentHash: "a".repeat(64),
      }),
    ]),
    complete: true,
    missingInputs: Object.freeze([]),
  }),
  policyVersion: "mercadolibre-question-answer-v1",
  expiresAt: "2026-07-29T00:00:00.000Z",
});

const unansweredQuestion = Object.freeze({
  id: 3957150025,
  item_id: "MLC123456",
  seller_id: 123456789,
  status: "UNANSWERED",
  answer: null,
  date_created: "2026-07-28T00:00:00.000Z",
});

const answeredQuestion = Object.freeze({
  ...unansweredQuestion,
  status: "ANSWERED",
  answer: Object.freeze({
    text: "Sí, tenemos stock disponible.",
    status: "ACTIVE",
    date_created: "2026-07-28T00:01:00.000Z",
  }),
});

function createExecutor() {
  const credentials = {
    get: vi.fn().mockResolvedValue({
      accessToken: "access-token",
      sellerId: "123456789",
    }),
  };
  return {
    credentials,
    executor: new MercadoLibreQuestionAnswerExecutor(credentials, {
      apiBaseUrl: "https://api.mercadolibre.com",
      allowedAccountId: "plasticov",
      policyVersion: "mercadolibre-question-answer-v1",
      timeoutMs: 5_000,
      maximumResponseBytes: 100_000,
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MercadoLibreQuestionAnswerExecutor", () => {
  it("preflights ownership, publishes the approved answer and returns a sanitized receipt", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(unansweredQuestion), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(answeredQuestion), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { executor } = createExecutor();

    const result = await executor.execute(baseAction);

    expect(result.providerReceipt).toMatchObject({
      provider: "mercadolibre",
      operation: "question.answer",
      actionId: baseAction.id,
      accountId: "plasticov",
      questionId: "3957150025",
      itemId: "MLC123456",
      sellerId: "123456789",
      answerStatus: "ACTIVE",
      idempotent: false,
      externalMutation: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.mercadolibre.com/questions/3957150025?api_version=4",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://api.mercadolibre.com/answers",
    );
    const post = fetchMock.mock.calls[1]?.[1];
    expect(post?.method).toBe("POST");
    expect(JSON.parse(String(post?.body))).toEqual({
      question_id: 3957150025,
      text: "Sí, tenemos stock disponible.",
    });
    const headers = new Headers(post?.headers);
    expect(headers.get("authorization")).toBe("Bearer access-token");
  });

  it("verifies the exact remote answer after execution", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify(answeredQuestion), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { executor } = createExecutor();
    const executed = Object.freeze({ ...baseAction, status: "executed" as const });

    const result = await executor.verify(executed);

    expect(result.verified).toBe(true);
    expect(result.observedState).toMatchObject({
      provider: "mercadolibre",
      operation: "question.answer",
      questionId: "3957150025",
      answerStatus: "ACTIVE",
    });
  });

  it("is idempotent only when the exact approved answer already exists", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify(answeredQuestion), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { executor } = createExecutor();

    const result = await executor.execute(baseAction);

    expect(result.providerReceipt).toMatchObject({ idempotent: true, externalMutation: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps every other MercadoLibre action blocked before credentials or HTTP are used", async () => {
    const { credentials, executor } = createExecutor();
    const forbidden = Object.freeze({
      ...baseAction,
      kind: "price.update" as const,
      target: "MLC123456",
      exactChanges: Object.freeze([Object.freeze({ field: "price", from: 10_000, to: 11_000 })]),
    });

    await expect(executor.execute(forbidden)).rejects.toThrow(/write operations are blocked/i);
    expect(credentials.get).not.toHaveBeenCalled();
  });

  it("rejects a different account, policy, seller or answer text", async () => {
    const { executor } = createExecutor();
    await expect(
      executor.execute(Object.freeze({ ...baseAction, accountId: "maustian" })),
    ).rejects.toThrow(/not enabled for account/);
    await expect(
      executor.execute(Object.freeze({ ...baseAction, policyVersion: "other-policy" })),
    ).rejects.toThrow(/policy version/);

    const sellerMismatch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ ...unansweredQuestion, seller_id: 999999999 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", sellerMismatch);
    await expect(executor.execute(baseAction)).rejects.toThrow(/belongs to seller/);

    const tooLong = Object.freeze({
      ...baseAction,
      exactChanges: Object.freeze([
        Object.freeze({ field: "answer.text", from: null, to: "x".repeat(2_001) }),
      ]),
    });
    await expect(executor.execute(tooLong)).rejects.toThrow(/cannot exceed 2000/);
  });
});
