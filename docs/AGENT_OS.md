# EAUTO-AI Agent OS

## Propósito

El Agent OS transforma EAUTO-AI en una organización empresarial gobernada. Los agentes no son prompts sueltos ni procesos con permisos implícitos: cada uno tiene contrato de rol, skills versionadas, preflight, work session, presupuesto, heartbeat, scorecard y evidencia.

La doctrina técnica proviene del libro completo:

- https://the-amazing-gentleman-programming-book.vercel.app/es

Los patrones transferidos de MSL y kiiess son referencias de diseño; no son dependencias runtime ni fuentes de autoridad.

## Jerarquía canónica

La organización admite exactamente dos niveles de delegación:

```text
CEO humano
└── CEO Agent
    ├── Directores
    └── Especialistas de cada director
```

El CEO Agent solo delega a directores. Un director solo delega a sus especialistas. Un especialista no crea otro nivel jerárquico.

## Departamentos

| Departamento   | Director              | Cobertura principal                                                             |
| -------------- | --------------------- | ------------------------------------------------------------------------------- |
| Finanzas       | `finance-director`    | verdad económica, unit economics, pricing y Ads                                 |
| Portafolio     | `portfolio-director`  | analytics, catálogo, oportunidades y retread                                    |
| Abastecimiento | `supply-director`     | proveedores, inventario, forecast e importaciones                               |
| Operaciones    | `operations-director` | ventas, preguntas, reclamos, reputación y logística                             |
| Crecimiento    | `growth-director`     | reconocimiento, lanzamiento, contenido, imagen, video, copy y Product Ads       |
| Expansión      | `expansion-director`  | ecommerce propio y nuevos marketplaces                                          |
| Gobernanza     | `governance-director` | memoria, investigación, experimentos, riesgo, auditoría y evaluación de agentes |

El catálogo completo vive en `packages/agent-kernel/src/companyCatalog.ts` y es validado al cargar el módulo.

## Contrato de rol

Cada agente declara:

- ID y versión;
- nivel y departamento;
- padre permitido;
- misión;
- inputs y outputs;
- evidencia obligatoria;
- capabilities permitidas y prohibidas;
- skills versionadas;
- autonomía predeterminada;
- riesgo;
- máximo de iteraciones;
- timeout;
- presupuesto diario en CLP;
- versión de prefijo estable;
- estado activo.

Las capabilities prohibidas globalmente incluyen:

- escrituras no aprobadas en marketplace;
- transferencias de dinero;
- lectura de credenciales;
- bypass de política;
- fabricación de evidencia;
- uso de memoria como verdad operacional.

## Skills

Una skill es un contrato versionado, no una competencia autodeclarada. Declara:

- capacidades permitidas y prohibidas;
- evidencia necesaria;
- riesgo;
- límites de iteración y tiempo;
- aprobación humana;
- clase de caché.

Las skills globales y por agente se hashean durante el preflight. Un cambio de versión invalida el contexto estable anterior.

## Preflight verificable

Antes de crear una work session se verifica:

1. contrato activo;
2. capability exacta;
3. política;
4. presupuesto diario;
5. profundidad de delegación;
6. evidencia completa;
7. autonomía y riesgo;
8. hashes de contrato y skills;
9. separación entre referencias estables y volátiles.

Resultados:

- `allow`: puede crear una sesión `queued`;
- `ask`: queda esperando evidencia o aprobación;
- `deny`: no se crea trabajo.

El preflight se persiste de forma append-only.

## Planner

El planner es determinista y no llama a LLM.

- El CEO selecciona como máximo cinco directores.
- Cada director selecciona como máximo cinco especialistas propios.
- Un objetivo sin señales suficientes produce `requiresClarification=true`.
- El planner nunca inventa un responsable.
- Todos los planes son consultivos y sus tareas indican si requieren aprobación.

Un futuro planner LLM deberá producir el mismo esquema y pasar por la validación determinista antes de persistirse.

## Work sessions

Estados:

- `queued`;
- `running`;
- `waiting-evidence`;
- `waiting-approval`;
- `completed`;
- `failed`;
- `cancelled`.

Cada sesión incluye:

- organización y cuenta;
- objetivo y agente;
- sesión padre;
- profundidad 0/1/2;
- acción;
- evidencia esperada y refs;
- políticas y skills;
- hash de prefijo;
- idempotency key;
- presupuesto y gasto CLP;
- iteraciones;
- heartbeat y deadline;
- outputs o motivo de fallo.

Una sesión duplicada por idempotency key devuelve la sesión original. Una sesión completada requiere referencias de output; los outcomes económicos todavía deben verificarse mediante receipts separados.

## Scorecards y autonomía

Los scorecards agregan:

- runs;
- completadas y fallidas;
- outcomes verificados;
- costos;
- tokens de caché hit/miss;
- correcciones humanas;
- violaciones de política;
- valor económico verificado;
- recomendación de autonomía.

La recomendación no cambia políticas. La promoción real continúa requiriendo una decisión explícita y un gate independiente.

Criterios mínimos heredados del runbook seguro de kiiess:

- `ask → inform`: historial perfecto suficiente y sin modificaciones humanas;
- `inform → autonomous`: historial adicional sin escalaciones, budget cap y rollback probado.

EAUTO-AI no habilita mutaciones externas mediante este Agent OS.

## Contexto y KV cache

El contexto se compila por capas:

1. Constitución y políticas globales estables.
2. Contrato, skills y cuenta versionados.
3. Evidencia y memoria recuperadas.
4. Objetivo, señales y resultados volátiles.

Solo las capas estables pueden formar el prefijo cacheable. Fechas, IDs aleatorios, señales y tool results permanecen al final.

## API

Lectura y planificación:

- `GET /v1/agent-os/catalog?accountId=...`
- `POST /v1/agent-os/:accountId/plans/company`
- `POST /v1/agent-os/:accountId/plans/department`
- `POST /v1/agent-os/:accountId/preflight`

Sesiones:

- `POST /v1/agent-os/:accountId/sessions`
- `POST /v1/agent-os/:accountId/sessions/:sessionId/start`
- `POST /v1/agent-os/:accountId/sessions/:sessionId/heartbeat`
- `POST /v1/agent-os/:accountId/sessions/:sessionId/complete`
- `POST /v1/agent-os/:accountId/sessions/:sessionId/fail`
- `GET /v1/agent-os/:accountId/sessions`
- `GET /v1/agent-os/:accountId/preflights`
- `GET /v1/agent-os/:accountId/scorecards`

Permisos:

- `agents.read`;
- `agents.run`;
- `agents.manage`.

Todos los endpoints imponen organization y account scope.

## Android

La pestaña `Agentes` permite:

- seleccionar Plasticov o Maustian;
- inspeccionar la jerarquía;
- ver sesiones y scorecards;
- preparar un plan CEO consultivo;
- revisar confianza, prioridad, aprobación y presupuesto.

La pantalla no promueve autonomía ni ejecuta acciones externas.

## Próximos gates antes de ejecución LLM

1. Provider gateway y telemetría real de cache hit/miss.
2. Admisión de evidence packs desde read models.
3. Context compiler por bloques estables/volátiles.
4. Work-order worker con lease y deadline.
5. Receipts de outputs y outcomes.
6. Memory retrieval gate.
7. Promoción de autonomía gobernada.
8. Simulación shadow antes de cualquier capability de escritura.
