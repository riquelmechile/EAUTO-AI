# LLM Gateway, KV cache y shadow mode

## Objetivo

Permitir razonamiento LLM dentro de EAUTO-AI sin convertir el modelo en autoridad de dominio ni concederle tools de escritura.

El gateway implementa inicialmente DeepSeek V4 mediante su API compatible con OpenAI, pero el puerto pertenece a la capa de aplicación y el dominio no depende del proveedor.

## Modelos y routing

Pricing version: `2026-07-26`.

| Task class | Modelo |
|---|---|
| classification, extraction, summarization | `deepseek-v4-flash` |
| planning, analysis, critical-review | `deepseek-v4-pro` |

Precios guardados en micro-USD por un millón de tokens:

| Modelo | Cache hit | Cache miss | Output |
|---|---:|---:|---:|
| Flash | 2.800 | 140.000 | 280.000 |
| Pro | 3.625 | 435.000 | 870.000 |

Los precios son una política versionada y deben compararse regularmente con la documentación oficial antes de desplegar una versión nueva.

## KV cache

DeepSeek gestiona la caché automáticamente y solo puede reutilizar prefijos coincidentes. EAUTO-AI estructura el contexto así:

1. Constitución global estable.
2. Política de seguridad estable.
3. Contrato de tools estable.
4. Contrato del agente versionado.
5. Política estable de cuenta.
6. Skills versionadas.
7. Contexto recuperado.
8. Trabajo volátil.

Las primeras seis capas forman `stablePrefix` y su SHA-256. Las capas recuperada y volátil se colocan después. Fechas, IDs, señales actuales y tool results nunca ingresan al prefijo estable.

La telemetría usa exclusivamente:

- `prompt_cache_hit_tokens`;
- `prompt_cache_miss_tokens`;
- `completion_tokens`;
- `reasoning_tokens` cuando existe;
- `total_tokens`.

El gateway rechaza una respuesta que no incluya hit/miss; no deduce miss desde `prompt_tokens`.

## Budgets

Cada run declara:

- presupuesto por run en micro-USD;
- máximo de prompt;
- máximo de output;
- modelo seleccionado;
- peor costo posible;
- presupuesto diario por cuenta.

Antes de invocar al proveedor, se calcula el peor caso usando todos los inputs como cache miss. Si excede el presupuesto del run o el presupuesto diario, se persiste un run `blocked` y no se llama a la API.

El costo real se calcula con hit, miss y output reportados por el proveedor.

## Shadow mode

Todos los runs son `mode=shadow`.

No hay tools disponibles. La salida JSON contiene:

- resumen;
- findings con evidence refs;
- propuestas;
- impacto esperado en CLP cuando existe evidencia;
- riesgo;
- `requiresHumanApproval=true` obligatorio;
- evidencia faltante;
- stop reason.

Una salida shadow:

- no crea acciones ejecutables;
- no publica;
- no cambia precios;
- no contesta preguntas;
- no interviene reclamos;
- no compra;
- no gasta presupuesto publicitario;
- no afirma que algo ocurrió.

El output puede convertirse posteriormente en una propuesta normal mediante un caso de uso separado, preflight, review, aprobación y receipts.

## Ledger

`llm_runs` guarda:

- organización, cuenta, agente y sesión;
- task class, provider, modelo y modo;
- hashes del prefijo y prompt completo;
- schemas;
- budgets;
- uso y costo;
- cache ratio;
- IDs del proveedor;
- output JSON y hash;
- estados y fallos.

Los estados son:

- `prepared`;
- `running`;
- `completed`;
- `failed`;
- `blocked`.

## Configuración

- `LLM_ENABLED=false` por defecto.
- `LLM_BASE_URL=https://api.deepseek.com`.
- `LLM_API_KEY` obligatorio cuando se habilita.
- `LLM_TIMEOUT_MS`.
- `LLM_DEFAULT_MAXIMUM_PROMPT_TOKENS`.
- `LLM_DEFAULT_MAXIMUM_OUTPUT_TOKENS`.
- `LLM_DAILY_ACCOUNT_BUDGET_MICROS_USD`.

En producción, el base URL debe usar HTTPS.

## API

- `POST /v1/agent-os/:accountId/sessions/:sessionId/shadow-run`
- `GET /v1/agent-os/:accountId/llm-runs`

Un shadow run exige:

- sesión Agent OS en estado `running`;
- organización y account scope;
- permiso `agents.run`;
- gateway habilitado;
- budget válido.

La constitución, políticas, identidad de agente y skills se compilan en servidor; el cliente no puede sustituirlos.

## JSON Output

El request usa `response_format={"type":"json_object"}`, temperatura cero y un contrato explícito que incluye la palabra JSON. La respuesta se analiza y valida nuevamente en el dominio. JSON válido no significa output confiable: la evidencia y las policies continúan siendo obligatorias.

## Próximos pasos

1. Evidence pack builder desde read models.
2. Memory retrieval gate con procedencia y frescura.
3. Work-order worker que ejecute shadow runs mediante lease.
4. Receipts de output y conversión controlada a propuestas.
5. Panel Android de consumo, cache ratio y fallos.
6. Proveedor local compatible, detrás del mismo puerto.
7. Shadow evaluation antes de considerar cualquier autonomía superior.
