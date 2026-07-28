import {
  validateSupplierProductObservation,
  type RecordedSupplierProduct,
  type SupplierProductObservation,
} from "@eauto/domain";

export type ForRecordingSupplierProductObservations = {
  record(observation: SupplierProductObservation): Promise<
    Readonly<{
      recorded: boolean;
      product: RecordedSupplierProduct;
    }>
  >;
};

export class SupplierMirrorService {
  constructor(private readonly observations: ForRecordingSupplierProductObservations) {}

  async recordObservation(observation: SupplierProductObservation): Promise<
    Readonly<{
      recorded: boolean;
      product: RecordedSupplierProduct;
    }>
  > {
    const validated = validateSupplierProductObservation(observation);
    return this.observations.record(validated);
  }
}
