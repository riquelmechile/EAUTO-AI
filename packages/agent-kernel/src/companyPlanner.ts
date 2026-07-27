import type { AgentPlan, AgentPlanTask, AgentRoleContract } from "@eauto/domain";
import { COMPANY_AGENT_CATALOG, getCompanyAgentContract } from "./companyCatalog.js";

const DIRECTOR_KEYWORDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "finance-director": [
    "margen",
    "rentabilidad",
    "ganancia",
    "costo",
    "precio",
    "pricing",
    "ads",
    "publicidad",
    "caja",
    "comisión",
  ],
  "portfolio-director": [
    "portafolio",
    "producto",
    "catálogo",
    "publicación",
    "listing",
    "oportunidad",
    "competencia",
    "renovar",
  ],
  "supply-director": [
    "stock",
    "inventario",
    "proveedor",
    "compra",
    "importación",
    "forecast",
    "reposición",
    "abastecimiento",
  ],
  "operations-director": [
    "orden",
    "venta",
    "pregunta",
    "reclamo",
    "devolución",
    "reputación",
    "despacho",
    "envío",
    "logística",
  ],
  "growth-director": [
    "contenido",
    "imagen",
    "video",
    "copy",
    "redes",
    "campaña",
    "lanzamiento",
    "foto",
    "creativo",
  ],
  "expansion-director": [
    "web",
    "ecommerce",
    "medusa",
    "amazon",
    "alibaba",
    "ripley",
    "marketplace",
    "global selling",
    "expansión",
  ],
  "governance-director": [
    "política",
    "auditoría",
    "autonomía",
    "memoria",
    "investigación",
    "experimento",
    "riesgo",
    "evidencia",
    "agente",
  ],
});

const SPECIALIST_KEYWORDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "economic-ingestion": ["ingesta", "reconciliar", "comisión", "costo real"],
  "unit-economics": ["unit economics", "contribución", "margen", "rentabilidad"],
  pricing: ["precio", "pricing", "repricing"],
  "ads-profitability": ["ads", "publicidad", "roas", "campaña"],
  analytics: ["analytics", "informe", "visitas", "conversión", "ventas"],
  catalog: ["atributo", "categoría", "catálogo", "duplicado"],
  "product-research": ["investigar producto", "oportunidad", "competencia"],
  "listing-retread": ["renovar", "refrescar", "retread", "publicación estancada"],
  "supplier-manager": ["proveedor", "lead time", "calidad proveedor"],
  "inventory-forecast": ["stock", "inventario", "forecast", "reposición"],
  "acquisition-imports": ["importación", "flete", "aduana", "landed cost", "comprar"],
  "sales-service": ["pregunta", "venta", "cliente", "conversión"],
  "claims-reputation": ["reclamo", "devolución", "reputación", "mediación"],
  "shipping-logistics": ["despacho", "envío", "tracking", "logística"],
  "product-recognition": ["identificar", "reconocer", "foto producto"],
  "product-launch": ["lanzar", "publicar producto", "lanzamiento"],
  "creative-studio": ["creative studio", "creativo", "assets"],
  "image-production": ["imagen", "foto", "fondo", "upscale"],
  "video-production": ["video", "reel", "story"],
  "copy-social": ["copy", "instagram", "facebook", "tiktok", "redes"],
  "product-ads": ["product ads", "campaña", "puja", "presupuesto"],
  "owned-ecommerce": ["web", "ecommerce", "medusa", "seo", "storefront"],
  "marketplace-expansion": ["amazon", "alibaba", "ripley", "global selling", "marketplace"],
  "memory-learning": ["memoria", "aprender", "outcome"],
  research: ["investigar", "investigación", "fuentes"],
  experimentation: ["experimento", "a/b", "hipótesis"],
  "risk-compliance": ["riesgo", "cumplimiento", "política"],
  "critic-auditor": ["criticar", "auditar", "abogado del diablo", "evidencia contraria"],
  "agent-evaluator": ["evaluar agente", "scorecard", "autonomía", "rendimiento agente"],
});

export function planCompanyObjective(input: {
  objective: string;
  maximumTasks?: number;
  budgetMinorClp?: number;
}): AgentPlan {
  const normalized = normalize(input.objective);
  const maximumTasks = Math.min(5, Math.max(1, input.maximumTasks ?? 5));
  const directors = scoreContracts(
    COMPANY_AGENT_CATALOG.filter((contract) => contract.level === "director"),
    normalized,
    DIRECTOR_KEYWORDS,
  ).slice(0, maximumTasks);

  if (directors.length === 0) {
    return Object.freeze({
      objective: input.objective,
      confidence: 0,
      tasks: Object.freeze([]),
      requiresClarification: true,
      clarificationReason: "No se pudo determinar un director responsable sin adivinar.",
    });
  }

  const budget = Math.max(0, input.budgetMinorClp ?? 0);
  const budgetPerTask = Math.floor(budget / directors.length);
  const tasks = directors.map(({ contract, score }, index) =>
    task({
      id: `director-task-${index + 1}`,
      contract,
      action: "plan.create",
      priority: index === 0 ? "high" : score >= 2 ? "medium" : "low",
      budgetMinorClp: budgetPerTask,
      dependsOn: [],
    }),
  );

  return Object.freeze({
    objective: input.objective,
    confidence: confidence(directors.map((entry) => entry.score)),
    tasks: Object.freeze(tasks),
    requiresClarification: false,
    clarificationReason: null,
  });
}

export function planDepartmentObjective(input: {
  directorAgentId: string;
  objective: string;
  maximumTasks?: number;
  budgetMinorClp?: number;
}): AgentPlan {
  const director = getCompanyAgentContract(input.directorAgentId);
  if (!director || director.level !== "director") {
    throw new Error(`${input.directorAgentId} is not a company director.`);
  }
  const normalized = normalize(input.objective);
  const candidates = COMPANY_AGENT_CATALOG.filter(
    (contract) => contract.level === "specialist" && contract.parentAgentId === director.id,
  );
  const specialists = scoreContracts(candidates, normalized, SPECIALIST_KEYWORDS).slice(
    0,
    Math.min(5, Math.max(1, input.maximumTasks ?? 5)),
  );

  if (specialists.length === 0) {
    return Object.freeze({
      objective: input.objective,
      confidence: 0,
      tasks: Object.freeze([]),
      requiresClarification: true,
      clarificationReason: `El director ${director.label} no pudo seleccionar un especialista sin adivinar.`,
    });
  }

  const budget = Math.max(0, input.budgetMinorClp ?? 0);
  const tasks = specialists.map(({ contract, score }, index) =>
    task({
      id: `specialist-task-${index + 1}`,
      contract,
      action: selectReadOnlyAction(contract),
      priority: index === 0 ? "high" : score >= 2 ? "medium" : "low",
      budgetMinorClp: Math.floor(budget / specialists.length),
      dependsOn: [],
    }),
  );

  return Object.freeze({
    objective: input.objective,
    confidence: confidence(specialists.map((entry) => entry.score)),
    tasks: Object.freeze(tasks),
    requiresClarification: false,
    clarificationReason: null,
  });
}

function scoreContracts(
  contracts: readonly AgentRoleContract[],
  normalizedObjective: string,
  keywords: Readonly<Record<string, readonly string[]>>,
): readonly { contract: AgentRoleContract; score: number }[] {
  return contracts
    .map((contract) => ({
      contract,
      score: (keywords[contract.id] ?? []).reduce(
        (total, keyword) => total + (normalizedObjective.includes(normalize(keyword)) ? 1 : 0),
        0,
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.contract.id.localeCompare(right.contract.id),
    );
}

function task(input: {
  id: string;
  contract: AgentRoleContract;
  action: string;
  priority: AgentPlanTask["priority"];
  budgetMinorClp: number;
  dependsOn: readonly string[];
}): AgentPlanTask {
  return Object.freeze({
    id: input.id,
    agentId: input.contract.id,
    action: input.action,
    priority: input.priority,
    dependsOn: Object.freeze([...input.dependsOn]),
    expectedEvidenceKinds: Object.freeze([...input.contract.requiredEvidenceKinds]),
    requiresApproval:
      input.contract.defaultAutonomy === "ask" ||
      input.contract.riskLevel === "high" ||
      input.contract.riskLevel === "critical",
    budgetMinorClp: input.budgetMinorClp,
  });
}

function selectReadOnlyAction(contract: AgentRoleContract): string {
  return (
    contract.allowedCapabilities.find(
      (capability) =>
        capability.endsWith(".read") ||
        capability.endsWith(".plan") ||
        capability.endsWith(".package") ||
        capability === "proposal.create",
    ) ??
    contract.allowedCapabilities[0] ??
    "evidence.request"
  );
}

function confidence(scores: readonly number[]): number {
  if (scores.length === 0) return 0;
  const total = scores.reduce((sum, score) => sum + score, 0);
  return Math.min(0.99, Number((0.55 + total / (total + 10)).toFixed(2)));
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("es-CL")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}
