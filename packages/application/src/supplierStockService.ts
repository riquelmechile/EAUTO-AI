import {
  evaluateSupplierStock,
  type StockAvailabilityProposal,
  type SupplierStockAssessment,
  type SupplierStockInput,
  type SupplierStockPolicy,
} from "@eauto/domain";

export type ForReadingSupplierStockInputs = {
  read(accountId: string, listingId: string): Promise<SupplierStockInput>;
};

export type ForSavingSupplierStockAssessments = {
  save(assessment: SupplierStockAssessment): Promise<void>;
};

export type ForSavingStockAvailabilityProposals = {
  save(proposal: StockAvailabilityProposal): Promise<void>;
};

export type ForSchedulingMarginReaudits = {
  schedule(input: Readonly<{
    organizationId: string;
    accountId: string;
    listingId: string;
    reason: string;
    evidenceRefs: readonly string[];
  }>): Promise<void>;
};

export class SupplierStockService {
  constructor(
    private readonly inputs: ForReadingSupplierStockInputs,
    private readonly assessments: ForSavingSupplierStockAssessments,
    private readonly proposals: ForSavingStockAvailabilityProposals,
    private readonly marginReaudits: ForSchedulingMarginReaudits,
  ) {}

  async evaluateListing(
    accountId: string,
    listingId: string,
    policy: SupplierStockPolicy,
  ): Promise<SupplierStockAssessment> {
    const input = await this.inputs.read(accountId, listingId);
    if (input.accountId !== accountId || input.listingId !== listingId) {
      throw new Error("Supplier stock reader returned data outside the requested scope.");
    }

    const assessment = evaluateSupplierStock(input, policy);
    await this.assessments.save(assessment);

    if (assessment.availabilityProposal) {
      await this.proposals.save(assessment.availabilityProposal);
    }
    const marginSignal = assessment.signals.find(
      (signal) => signal.kind === "margin.reaudit-required",
    );
    if (marginSignal) {
      await this.marginReaudits.schedule({
        organizationId: assessment.organizationId,
        accountId: assessment.accountId,
        listingId: assessment.listingId,
        reason: String(marginSignal.details.reason ?? "supplier-stock-change"),
        evidenceRefs: assessment.evidenceRefs,
      });
    }

    return assessment;
  }
}
