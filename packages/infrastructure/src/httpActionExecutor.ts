import type { ActionExecutor } from "@eauto/application";
import type { BusinessAction } from "@eauto/domain";

export type HttpActionRoute = Readonly<{
  executeUrl: string;
  verifyUrl: string;
}>;

export type HttpActionRoutes = Readonly<Record<string, HttpActionRoute>>;

export class DisabledActionExecutor implements ActionExecutor {
  execute(action: BusinessAction): Promise<{ providerReceipt: unknown }> {
    return Promise.reject(
      new Error(
        `External action execution is disabled. Configure ACTION_EXECUTION_ENABLED and an allowlisted route for ${action.kind}.`,
      ),
    );
  }

  verify(action: BusinessAction): Promise<{ verified: boolean; observedState: unknown }> {
    return Promise.reject(new Error(`External verification is disabled for action ${action.id}.`));
  }
}

export class HttpActionExecutor implements ActionExecutor {
  constructor(
    private readonly routes: HttpActionRoutes,
    private readonly config: Readonly<{
      apiKey: string;
      timeoutMs: number;
      maximumResponseBytes: number;
      providerName: string;
    }>,
  ) {}

  async execute(action: BusinessAction): Promise<{ providerReceipt: unknown }> {
    const route = this.requireRoute(action.kind);
    const providerResponse = await this.postJson(route.executeUrl, action, "execute");
    return {
      providerReceipt: Object.freeze({
        provider: this.config.providerName,
        actionId: action.id,
        actionKind: action.kind,
        target: action.target,
        response: providerResponse,
      }),
    };
  }

  async verify(action: BusinessAction): Promise<{ verified: boolean; observedState: unknown }> {
    const route = this.requireRoute(action.kind);
    const response = await this.postJson(route.verifyUrl, action, "verify");
    if (!isRecord(response) || typeof response.verified !== "boolean") {
      throw new Error("Action verification response must contain a boolean verified field.");
    }
    return {
      verified: response.verified,
      observedState: "observedState" in response ? response.observedState : response,
    };
  }

  private requireRoute(kind: string): HttpActionRoute {
    const route = this.routes[kind];
    if (!route) throw new Error(`No allowlisted action provider route exists for ${kind}.`);
    return route;
  }

  private async postJson(
    url: string,
    action: BusinessAction,
    operation: "execute" | "verify",
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": `${action.id}:${operation}`,
          "user-agent": "eauto-ai/production-action-executor",
        },
        body: JSON.stringify({
          operation,
          action: {
            id: action.id,
            accountId: action.accountId,
            kind: action.kind,
            target: action.target,
            exactChanges: action.exactChanges,
            rationale: action.rationale,
            risk: action.risk,
            policyVersion: action.policyVersion,
            evidenceBundleId: action.evidenceBundle.id,
            expiresAt: action.expiresAt,
          },
        }),
        signal: controller.signal,
      });
      const text = await readLimitedText(response, this.config.maximumResponseBytes);
      if (!response.ok) {
        throw new Error(
          `Action provider ${operation} failed with HTTP ${response.status}: ${sanitize(text)}`,
        );
      }
      if (!text) return Object.freeze({ status: response.status });
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`Action provider ${operation} returned invalid JSON.`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Action provider ${operation} timed out after ${this.config.timeoutMs} ms.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readLimitedText(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`Action provider response exceeds ${maximumBytes} bytes.`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maximumBytes) {
    throw new Error(`Action provider response exceeds ${maximumBytes} bytes.`);
  }
  return new TextDecoder().decode(buffer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitize(value: string): string {
  return value.replaceAll(/[\r\n\t]+/g, " ").slice(0, 500);
}
