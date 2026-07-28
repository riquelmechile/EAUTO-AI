import assert from "node:assert/strict";
import { MercadoLibreQuestionAnswerExecutor } from "../packages/infrastructure/dist/index.js";

const action = Object.freeze({
  id: "action_question_smoke",
  accountId: "plasticov",
  kind: "question.answer",
  target: "3957150025",
  exactChanges: Object.freeze([
    Object.freeze({ field: "answer.text", from: null, to: "Sí, tenemos stock disponible." }),
  ]),
  rationale: "Smoke contract for a human-approved answer.",
  risk: "low",
  status: "executing",
  evidenceBundle: Object.freeze({
    id: "evidence_question_smoke",
    accountId: "plasticov",
    references: Object.freeze([
      Object.freeze({
        id: "reference_question_smoke",
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

const unanswered = {
  id: 3957150025,
  item_id: "MLC123456",
  seller_id: 123456789,
  status: "UNANSWERED",
  answer: null,
};
const answered = {
  ...unanswered,
  status: "ANSWERED",
  answer: {
    text: "Sí, tenemos stock disponible.",
    status: "ACTIVE",
    date_created: "2026-07-28T00:01:00.000Z",
  },
};

const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (input, init) => {
  requests.push({ url: String(input), init });
  const payload = requests.length === 1 ? unanswered : answered;
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

try {
  const executor = new MercadoLibreQuestionAnswerExecutor(
    {
      get: async () => ({ accessToken: "smoke-token", sellerId: "123456789" }),
    },
    {
      apiBaseUrl: "https://api.mercadolibre.com",
      allowedAccountId: "plasticov",
      policyVersion: "mercadolibre-question-answer-v1",
      timeoutMs: 5_000,
      maximumResponseBytes: 100_000,
    },
  );

  const execution = await executor.execute(action);
  assert.equal(execution.providerReceipt.operation, "question.answer");
  assert.equal(execution.providerReceipt.externalMutation, true);
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].url,
    "https://api.mercadolibre.com/questions/3957150025?api_version=4",
  );
  assert.equal(requests[1].url, "https://api.mercadolibre.com/answers");
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    question_id: 3957150025,
    text: "Sí, tenemos stock disponible.",
  });

  const verification = await executor.verify(Object.freeze({ ...action, status: "executed" }));
  assert.equal(verification.verified, true);
  assert.equal(requests.length, 3);
  console.log("MercadoLibre question.answer contract smoke passed.");
} finally {
  globalThis.fetch = originalFetch;
}
