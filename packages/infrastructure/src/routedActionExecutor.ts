import type { ActionExecutor } from "@eauto/application";
import type { ActionKind, BusinessAction } from "@eauto/domain";

export type ActionExecutorRoutes = Readonly<Partial<Record<ActionKind, ActionExecutor>>>;

export class RoutedActionExecutor implements ActionExecutor {
  constructor(
    private readonly routes: ActionExecutorRoutes,
    private readonly fallback: ActionExecutor,
  ) {}

  execute(action: BusinessAction): Promise<{ providerReceipt: unknown }> {
    return (this.routes[action.kind] ?? this.fallback).execute(action);
  }

  verify(action: BusinessAction): Promise<{ verified: boolean; observedState: unknown }> {
    return (this.routes[action.kind] ?? this.fallback).verify(action);
  }
}
