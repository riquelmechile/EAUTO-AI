# SDD — Profit Engine y Repricing gobernado

## Problema

EAUTO-AI necesita convertir ventas, costos, comisiones, envío, Ads y devoluciones en una verdad económica determinista por publicación. Hoy existe infraestructura de evidencia y acciones, pero falta un hexágono económico capaz de bloquear decisiones cuando faltan inputs y producir propuestas de precio justificables.

## Objetivo

Entregar un vertical slice que:

1. calcule ingreso, costo total, utilidad neta y margen en basis points;
2. declare explícitamente inputs faltantes;
3. clasifique una publicación como rentable, bajo piso, pérdida o incompleta;
4. calcule el precio mínimo necesario para alcanzar un margen objetivo;
5. genere una propuesta de repricing sin ejecutar ninguna mutación;
6. preserve evidencia, policy version y aprobación humana obligatoria.

## Principios aplicados

- **Clean Architecture:** el dominio económico no depende de PostgreSQL, MercadoLibre, Fastify, Android ni LLM.
- **Arquitectura hexagonal:** lectores económicos y repositorios son puertos; MercadoLibre y PostgreSQL serán adaptadores.
- **Screaming Architecture:** los módulos se llaman `profitEngine` y `repricing`, no `databaseUtils` o `apiHelpers`.
- **TDD:** las reglas se especifican con tests antes de conectar infraestructura.
- **Autoridad nativa:** código posee fórmulas, estados, IDs, policy, evidencia y aprobación. El LLM solo podrá explicar la propuesta.
- **Verifiable Trust:** inputs incompletos bloquean el cálculo; no se inventan costos ni márgenes.
- **Orquestación acotada:** detectors deterministas producen señales; un agente solo se despierta si existe utilidad esperada suficiente.
- **Prompt/KV cache:** las reglas económicas son prefijo estable; snapshot y tarea son sufijo volátil.

## Dominio

### Inputs autoritativos

- precio actual;
- cantidad;
- costo de producto;
- costo de envío/fulfillment;
- costo de empaque;
- costo Ads atribuible;
- devoluciones/descuentos esperados;
- tasa variable de marketplace/impuestos;
- referencias de evidencia y fecha de observación.

### Inputs mínimos obligatorios

- `product-cost`;
- `marketplace-fee-rate`;
- `fulfillment-cost`.

Si falta cualquiera, el resultado es `incomplete` y no existe utilidad ni propuesta de precio.

### Estados

- `profitable`: margen actual mayor o igual al piso;
- `below-floor`: utilidad positiva, pero margen inferior al piso;
- `loss`: utilidad negativa;
- `incomplete`: faltan inputs autoritativos.

### Repricing

El precio mínimo se calcula de forma determinista:

`minimumPrice = ceil(fixedCosts / (1 - variableRate - targetMargin))`

La propuesta queda bloqueada cuando:

- faltan inputs;
- tasa variable + margen objetivo >= 100%;
- el precio requerido supera el aumento máximo permitido;
- supera un techo competitivo autoritativo;
- la evidencia está vencida.

## Puertos

- `ForReadingEconomicInputs`
- `ForSavingProfitSnapshots`
- `ForSavingRepricingProposals`

## Casos de uso

1. `AuditListingProfitability`
2. `PrepareRepricingProposal`

## No objetivos de esta entrega

- escribir precios en MercadoLibre;
- usar LLM para calcular costos o margen;
- estimar costos faltantes;
- optimizar Ads;
- comparar competidores sin evidencia autoritativa.

## Criterios de aceptación

- moneda CLP y enteros seguros;
- cero división o NaN;
- inputs faltantes visibles;
- propuesta siempre `requiresApproval=true`;
- ninguna dependencia de infraestructura en dominio;
- tests de rentable, bajo piso, pérdida, incompleto y policy bloqueada;
- mismo input produce mismo output.
