# Juicio final de capacidades — EAUTO-AI vs MSL y kiiess

## Veredicto

EAUTO-AI integra el núcleo comercial y de gobernanza de MSL y kiiess y, desde SDD 019, también incorpora las nueve capacidades que estaban pendientes en la primera auditoría.

La fuente canónica es `config/capability-parity.json`. El comando `npm run doctor:parity` comprueba que toda capacidad declarada como implementada tenga evidencia real dentro del repositorio.

| Estado       | Cantidad | Significado                                                         |
| ------------ | -------: | ------------------------------------------------------------------- |
| Implementada |       23 | Existe una capacidad equivalente, scoped y verificable en EAUTO-AI. |
| Parcial      |        0 | No quedan capacidades parciales en la matriz actual.                |
| Ausente      |        7 | Es una expansión distinta que todavía no existe.                    |
| Reemplazada  |        2 | La tecnología fue sustituida intencionalmente.                      |

## Núcleo ya implementado

- aprobación, ejecución, receipts y estado `uncertain`;
- aislamiento Plasticov/Maustian;
- Agent OS, work sessions, heartbeats y scorecards;
- transactional outbox, leases, retries y dead-letter;
- evidence packs y read models verificables;
- Profit Engine y margin audit;
- MercadoLibre read plane y `question.answer` gobernado;
- Product Ads v2;
- Supplier Mirror y stock risk;
- Catalog Acquisition y Photo-to-Similar;
- Android, PostgreSQL, MinIO, backups y release.

## Ola Gentleman completada

### Bus general entre agentes

`AgentMessageBusService` publica mensajes scoped, idempotentes y correlacionados. PostgreSQL controla leases, retries y dead-letter; un mensaje duplicado no duplica el trabajo.

### Evidence Response Router

Las solicitudes de evidencia eligen un responder compatible, congelan documentos con provenance y declaran `missingInputs`. Una respuesta incompleta no pasa a completa por narración de un agente.

### Memoria semántica

La memoria consultiva usa observaciones estructuradas, topic keys, keywords, full-text ranking, retrieval gate, expiración, outcome verificado y reconciliación `compatible/supersedes/conflicts`. No reemplaza los read models autoritativos.

### Account Brain

Construye snapshots por cuenta para economía, catálogo, clientes, supply, publicidad, contenido y reputación. Declara evidencia, memoria usada, score, findings, prioridades y datos faltantes.

### Dieciséis daemons especialistas

Un scheduler declarativo reutiliza exactamente los dieciséis contratos del Agent OS. Cada daemon obtiene evidencia fresca y solo crea work orders gobernadas en modo `ask`.

### Creative Studio concreto

El adapter MiniMax usa el host oficial fijo, generación de imagen, video asincrónico, polling acotado y file retrieval. Los archivos se descargan con límites y se guardan en object storage privado antes de ser registrados. No publica en canales.

### Supply workflows completos

Están modelados `supplier.pause`, `supplier.full-scrape`, `stock.sync`, `stock.autopause` y `purchase.opportunistic`. Consultan Supplier Mirror, listing, Profit Engine y policy version. Permanecen en dry-run y producen propuestas, nunca compras o pausas directas.

### Lifecycle BI

Clasifica `active`, `seasonal`, `off-season`, `obsolete-candidate`, `insufficient-data` y `uncertain`. Evidencia stale o insuficiente degrada la clasificación en vez de inventar certeza.

### CLI económica operacional

Disponibles:

```bash
npm run economic:ingest -- --account=plasticov
npm run economic:status -- --account=plasticov
npm run economic:coverage -- --account=plasticov
npm run economic:reconcile -- --account=plasticov
npm run economic:missing -- --account=plasticov
npm run economic:inspect-evidence -- --account=plasticov --listing=MLC123
```

La CLI audita y reconcilia PostgreSQL; no habilita escrituras MercadoLibre.

## Capacidades distintas que siguen ausentes

1. Telegram como transporte CEO y aprobación “dale”.
2. Servidor MCP.
3. Cortex como grafo neuronal hebbiano/darwiniano.
4. Routing local/cloud con LiteLLM, llama.cpp o vLLM.
5. Boundary Medusa para ecommerce propio.
6. Adaptadores productivos para redes sociales.
7. Amazon, Alibaba y otros marketplaces.

La memoria semántica implementada no se declara Cortex. El bus de agentes no se declara MCP. Creative Studio no se declara publicación social.

## Decisiones de reemplazo

- **Consola web:** Android continúa como control plane canónico.
- **Redis como cola:** PostgreSQL transactional outbox y leases mantienen una única fuente durable.

## Regla de aceptación

Una capacidad pasa a `implemented` solo cuando tiene:

1. contrato de dominio o aplicación;
2. persistencia o adapter cuando corresponde;
3. aislamiento por organización/cuenta;
4. tests adversariales;
5. doctor o smoke productivo;
6. política fail-closed para efectos externos.
