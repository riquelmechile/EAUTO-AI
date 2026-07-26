# Doctrine Matrix

| Principio                   | Implementación                                                    | Gate/Test                    |
| --------------------------- | ----------------------------------------------------------------- | ---------------------------- |
| Clean Architecture          | `packages/domain` no importa frameworks                           | `tests/architecture.test.ts` |
| LLM como infraestructura    | puertos en application; adaptadores externos                      | architectural test           |
| Scope Rule                  | código por capability; shared solo cuando se usa transversalmente | revisión + lint              |
| TDD                         | state machines, prompt cache, wake policy y receipts con tests    | CI                           |
| Contexto como presupuesto   | prompt dividido en estable, recuperado y volátil                  | `promptCompiler.test.ts`     |
| KV cache                    | hash del prefijo estable; hit/miss separados                      | cost tests futuros           |
| Loops acotados              | `WorkOrder.maxIterations` y timeout                               | domain constraints           |
| Confianza verificable       | receipt chain + approval action hash + verification read          | `actionService.test.ts`      |
| Evidencia antes de decisión | `assertCompleteEvidence`                                          | action service test          |
| Autonomía gradual           | ASK/INFORM/AUTONOMOUS y fail-closed                               | autonomy tests futuros       |
