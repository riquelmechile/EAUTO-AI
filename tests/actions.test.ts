import { describe, expect, it } from "vitest";
import { transitionAction, type BusinessAction } from "../packages/domain/src/actions.js";

const action: BusinessAction = {
  id: "a1",
  accountId: "plasticov",
  kind: "price-change",
  target: "MLC1",
  exactChanges: [{ field: "price", from: 10_000, to: 9_500 }],
  rationale: "test",
  risk: "low",
  status: "draft",
  evidenceBundle: {
    id: "e1",
    accountId: "plasticov",
    references: [],
    complete: false,
    missingInputs: ["cost"],
  },
  policyVersion: "v1",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

describe("action state machine", () => {
  it("allows declared transitions", () => {
    expect(transitionAction(action, "proposed").status).toBe("proposed");
  });
  it("blocks undeclared transitions", () => {
    expect(() => transitionAction(action, "verified")).toThrow(/Invalid action transition/);
  });
});
