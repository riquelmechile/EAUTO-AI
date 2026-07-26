import { createHash } from "node:crypto";
import {
  assertCompleteEvidence,
  transitionAction,
  type Approval,
  type BusinessAction,
} from "@eauto/domain";
import { createReceipt } from "@eauto/agent-kernel";
import type { OutboxEventDraft } from "./outbox.js";
import type {
  ActionExecutor,
  ActionRepository,
  Clock,
  IdGenerator,
  ReceiptRepository,
} from "./ports.js";

export class ActionService {
  constructor(
    private readonly actions: ActionRepository,
    private readonly receipts: ReceiptRepository,
    private readonly executor: ActionExecutor,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async propose(action: BusinessAction, proposedBy = "system"): Promise<BusinessAction> {
    assertCompleteEvidence(action.evidenceBundle);
    const proposed = transitionAction(action, "proposed");
    await this.actions.save(
      proposed,
      this.lifecycleEvent(proposed, "action.proposed", { proposedBy }),
    );
    await this.appendReceipt(proposed, "proposal", {
      exactChanges: proposed.exactChanges,
      proposedBy,
    });
    return proposed;
  }

  async markReviewed(actionId: string, reviewedBy = "system"): Promise<BusinessAction> {
    const action = await this.requireAction(actionId);
    const reviewed = transitionAction(action, "reviewed");
    await this.actions.save(
      reviewed,
      this.lifecycleEvent(reviewed, "action.reviewed", { reviewedBy, risk: reviewed.risk }),
    );
    await this.appendReceipt(reviewed, "review", { reviewedBy, risk: reviewed.risk });
    return reviewed;
  }

  async approve(actionId: string, approvedBy: string): Promise<Approval> {
    const action = await this.requireAction(actionId);
    if (action.status !== "reviewed") throw new Error("Action must be reviewed before approval.");
    if (Date.parse(action.expiresAt) <= this.clock.now().getTime()) throw new Error("Action expired.");
    const actionHash = hashAction(action);
    const approval: Approval = Object.freeze({
      id: this.ids.next("approval"),
      actionId: action.id,
      actionHash,
      approvedBy,
      approvedAt: this.clock.now().toISOString(),
      expiresAt: action.expiresAt,
    });
    const approved = transitionAction(action, "approved");
    await this.actions.saveApproval(
      approval,
      approved,
      this.lifecycleEvent(approved, "action.approved", { approvedBy, approvalId: approval.id }),
    );
    await this.appendReceipt(approved, "approval", approval);
    return approval;
  }

  async execute(actionId: string, requestedBy = "system"): Promise<BusinessAction> {
    const action = await this.requireAction(actionId);
    const approval = await this.actions.getApproval(actionId);
    if (!approval) throw new Error("Approval required.");
    if (approval.actionHash !== hashAction(action)) {
      throw new Error("Approval no longer matches action content.");
    }
    if (Date.parse(approval.expiresAt) <= this.clock.now().getTime()) {
      throw new Error("Approval expired.");
    }

    const executing = transitionAction(action, "executing");
    await this.actions.save(
      executing,
      this.lifecycleEvent(executing, "action.execution.started", { requestedBy }),
    );
    try {
      const result = await this.executor.execute(executing);
      const executed = transitionAction(executing, "executed");
      await this.actions.save(
        executed,
        this.lifecycleEvent(executed, "action.executed", {
          requestedBy,
          providerReceipt: result.providerReceipt,
        }),
      );
      await this.appendReceipt(executed, "execution", result.providerReceipt);

      const verification = await this.executor.verify(executed);
      if (!verification.verified) throw new Error("Remote verification failed.");
      const verified = transitionAction(executed, "verified");
      await this.actions.save(
        verified,
        this.lifecycleEvent(verified, "action.verified", {
          requestedBy,
          observedState: verification.observedState,
        }),
      );
      await this.appendReceipt(verified, "verification", verification.observedState);
      return verified;
    } catch (error) {
      const failed = transitionAction(executing, "failed");
      await this.actions.save(
        failed,
        this.lifecycleEvent(failed, "action.failed", {
          requestedBy,
          error: error instanceof Error ? error.message : "Unknown execution error",
        }),
      );
      throw error;
    }
  }

  private lifecycleEvent(
    action: BusinessAction,
    eventType: string,
    payload: unknown,
  ): OutboxEventDraft {
    return Object.freeze({
      id: this.ids.next("event"),
      idempotencyKey: `${action.id}:${eventType}:${action.status}`,
      aggregateType: "business_action",
      aggregateId: action.id,
      accountId: action.accountId,
      eventType,
      payload: Object.freeze({ actionId: action.id, accountId: action.accountId, payload }),
      availableAt: this.clock.now().toISOString(),
    });
  }

  private async appendReceipt(
    action: BusinessAction,
    type: "proposal" | "review" | "approval" | "execution" | "verification",
    payload: unknown,
  ): Promise<void> {
    const chain = await this.receipts.listForAction(action.id);
    const previous = chain.at(-1);
    await this.receipts.append(
      createReceipt({
        id: this.ids.next("receipt"),
        type,
        accountId: action.accountId,
        actionId: action.id,
        contentHash: hashAction(action),
        policyHash: createHash("sha256").update(action.policyVersion).digest("hex"),
        evidenceHash: action.evidenceBundle.id,
        previousReceiptHash: previous?.chainHash ?? null,
        payload,
        recordedAt: this.clock.now().toISOString(),
      }),
    );
  }

  private async requireAction(id: string): Promise<BusinessAction> {
    const action = await this.actions.get(id);
    if (!action) throw new Error(`Action ${id} not found.`);
    return action;
  }
}

function hashAction(action: BusinessAction): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: action.id,
        accountId: action.accountId,
        kind: action.kind,
        target: action.target,
        exactChanges: action.exactChanges,
        rationale: action.rationale,
        risk: action.risk,
        evidenceBundle: action.evidenceBundle,
        policyVersion: action.policyVersion,
        expiresAt: action.expiresAt,
      }),
    )
    .digest("hex");
}
