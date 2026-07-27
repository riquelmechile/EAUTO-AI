import {
  calculateProfitability,
  prepareRepricingProposal,
  type ProfitabilityInput,
  type ProfitabilitySnapshot,
  type RepricingDecision,
  type RepricingPolicy,
  type RepricingProposal,
} from "@eauto/domain";

export type ForReadingEconomicInputs = {
  read(accountId: string, listingId: string): Promise<ProfitabilityInput>;
};

export type ForSavingProfitSnapshots = {
  save(snapshot: ProfitabilitySnapshot): Promise<void>;
};

export type ForSavingRepricingProposals = {
  save(proposal: RepricingProposal): Promise<void>;
};

export class ProfitEngineService {
  constructor(
    private readonly inputs: ForReadingEconomicInputs,
    private readonly snapshots: ForSavingProfitSnapshots,
    private readonly proposals: ForSavingRepricingProposals,
  ) {}

  async auditListing(accountId: string, listingId: string): Promise<ProfitabilitySnapshot> {
    const input = await this.inputs.read(accountId, listingId);
    if (input.accountId !== accountId || input.listingId !== listingId) {
      throw new Error("Economic input reader returned data outside the requested scope.");
    }
    const snapshot = calculateProfitability(input);
    await this.snapshots.save(snapshot);
    return snapshot;
  }

  async prepareRepricing(
    accountId: string,
    listingId: string,
    policy: RepricingPolicy,
  ): Promise<RepricingDecision> {
    const snapshot = await this.auditListing(accountId, listingId);
    const decision = prepareRepricingProposal(snapshot, policy);
    if (decision.status === "proposed") await this.proposals.save(decision);
    return decision;
  }
}
