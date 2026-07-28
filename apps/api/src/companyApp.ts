import {
  AuthorizationError,
  assertAuthorized,
  canAccessAccount,
  type ActorIdentity,
  type Permission,
} from "@eauto/domain";
import { createAuthenticator, readBearerToken } from "./auth.js";
import { buildApp } from "./app.js";
import { createCompanyIntelligenceRuntime } from "./companyIntelligenceRuntime.js";
import { registerCompanyIntelligenceRoutes } from "./companyIntelligenceRoutes.js";
import type { AppConfig } from "./config.js";
import { createOperationalIntelligenceRuntime } from "./operationalIntelligenceRuntime.js";
import { createRuntime } from "./runtime.js";

export async function buildCompanyApp(config: AppConfig) {
  const runtime = createRuntime(config);
  const intelligenceRuntime = createOperationalIntelligenceRuntime(runtime, config);
  const companyRuntime = createCompanyIntelligenceRuntime(runtime, intelligenceRuntime, config);
  const authenticator = createAuthenticator({
    mode: config.AUTH_MODE,
    identitiesJson: config.OPERATOR_TOKENS_JSON,
    nodeEnv: config.NODE_ENV,
  });
  const app = await buildApp(config, runtime);

  registerCompanyIntelligenceRoutes(app, {
    runtime: companyRuntime,
    authenticate: async (request) => {
      if (authenticator.developmentActor) return authenticator.developmentActor;
      const accessToken = readBearerToken(request.headers.authorization);
      return runtime.sessionService.authenticateAccess(accessToken);
    },
    requireAccount: async (actor, accountId, permission) => {
      await requireAccount(runtime, actor, accountId, permission);
    },
  });

  app.addHook("onClose", async () => {
    await companyRuntime.close();
    await intelligenceRuntime.close();
  });

  return Object.assign(app, { companyRuntime });
}

async function requireAccount(
  runtime: ReturnType<typeof createRuntime>,
  actor: ActorIdentity,
  accountId: string,
  permission: Permission,
): Promise<void> {
  const account = await runtime.accounts.get(accountId);
  if (
    !account ||
    account.organizationId !== actor.organizationId ||
    !canAccessAccount(actor, account.id)
  ) {
    throw new AuthorizationError("The requested account is outside the actor scope.");
  }
  assertAuthorized(actor, permission, account.id);
}
