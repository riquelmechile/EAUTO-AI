import { createHash } from "node:crypto";
import {
  assertCompleteEvidence,
  transitionAction,
  type Approval,
  type BusinessAction,
} from "@eauto/domain";
import type { OutboxEventDraft } from "./outbox.js";
import type { ActionExecutor, ActionRepository, Clock, IdGenerator } from "./ports.js";

export class ActionService {
  constructor(
    private readonly actions: ActionRepository,
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
      this.receiptDraft(proposed, "proposal", {
        exactChanges: proposed.exactChanges,
        proposedBy,
      }),
    );
    return proposed;
  }

  async markReviewed(actionId: string, reviewedBy = "system"): Promise<BusinessAction> {
    const action = await this.requireAction(actionId);
    const reviewed = transitionAction(action, "reviewed");
    await this.actions.save(
      reviewed,
      this.lifecycleEvent(reviewed, "action.reviewed", { reviewedBy, risk: reviewed.risk }),
      this.receiptDraft(reviewed, "review", { reviewedBy, risk: reviewed.risk }),
    );
    return reviewed;
  }

  async approve(actionId: string, approvedBy: string): Promise<Approval> {
    const action = await this.requireAction(actionId);
    if (action.status !== "reviewed") throw new Error("Action must be reviewed before approval.");
    if (Date.parse(action.expiresAt) <= this.clock.now().getTime())
      throw new Error("Action expired.");
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
      this.receiptDraft(approved, "approval", approval),
    );
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
    let current: BusinessAction = executing;
    try {
      const result = await this.executor.execute(executing);
      current = transitionAction(executing, "executed");
      await this.actions.save(
        current,
        this.lifecycleEvent(current, "action.executed", {
          requestedBy,
          providerReceipt: result.providerReceipt,
        }),
        this.receiptDraft(current, "execution", result.providerReceipt),
      );

      const verification = await this.executor.verify(current);
      if (!verification.verified) throw new Error("Remote verification failed.");
      const verified = transitionAction(current, "verified");
      await this.actions.save(
        verified,
        this.lifecycleEvent(verified, "action.verified", {
          requestedBy,
          observedState: verification.observedState,
        }),
        this.receiptDraft(verified, "verification", verification.observedState),
      );
      return verified;
    } catch (error) {
      const uncertain = transitionAction(current, "uncertain");
      const uncertaintyPayload = {
        requestedBy,
        error: error instanceof Error ? error.message : "Unknown execution error",
        remoteState: "unknown",
        requiresReconciliation: true,
      };
      await this.actions.save(
        uncertain,
        this.lifecycleEvent(uncertain, "action.uncertain", uncertaintyPayload),
        this.receiptDraft(uncertain, "outcome", uncertaintyPayload),
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

  private receiptDraft(
    action: BusinessAction,
    type: "proposal" | "review" | "approval" | "execution" | "verification" | "outcome",
    payload: unknown,
  ) {
    return Object.freeze({
      id: this.ids.next("receipt"),
      type,
      accountId: action.accountId,
      actionId: action.id,
      contentHash: hashAction(action),
      policyHash: createHash("sha256").update(action.policyVersion).digest("hex"),
      evidenceHash: action.evidenceBundle.id,
      payload,
      recordedAt: this.clock.now().toISOString(),
    });
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
