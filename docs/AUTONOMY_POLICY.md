# Autonomy Policy

## ASK

El agente analiza y prepara, pero toda mutación requiere aprobación humana.

## INFORM

Solo acciones previamente autorizadas, de bajo riesgo y reversibles. El CEO recibe información antes o inmediatamente después según contrato.

## AUTONOMOUS

Requiere simultáneamente:

- Acción reversible.
- Riesgo dentro del límite.
- Evidence bundle completo y fresco.
- Historial mínimo de acciones verificadas.
- Budget cap disponible.
- Idempotency key.
- Receipt chain.
- Verification read posterior.
- Rollback probado.

La ausencia de una política equivale a ASK. La ausencia del motor de autonomía nunca permite autoejecución.

## Promoción

- ASK → INFORM: diez acciones aprobadas sin modificación y sin incidentes.
- INFORM → AUTONOMOUS: veinte acciones verificadas, budget cap y rollback probado.

Un incidente degrada automáticamente a ASK.
