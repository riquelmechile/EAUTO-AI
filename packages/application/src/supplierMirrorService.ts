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

  recordObservation(observation: SupplierProductObservation): Promise<
    Readonly<{
      recorded: boolean;
      product: RecordedSupplierProduct;
    }>
  > {
    return this.observations.record(validateSupplierProductObservation(observation));
  }
}
