# Agent OS

## Propósito

Diseñar, validar y operar la organización agéntica de EAUTO-AI sin permitir que los modelos sustituyan políticas, evidencia o máquinas de estados.

## Entrada mínima

- organización y cuenta;
- objetivo;
- contrato de rol versionado;
- skills versionadas;
- política vigente;
- evidencia disponible;
- autonomía solicitada;
- presupuesto CLP;
- deadline e idempotency key.

## Procedimiento

1. Validar jerarquía CEO → director → especialista.
2. Crear un plan acotado o solicitar aclaración.
3. Ejecutar preflight determinista.
4. Persistir hashes de contrato, skills y contexto estable.
5. Crear work session idempotente.
6. Mantener heartbeat, iteraciones, gasto y deadline.
7. Producir outputs referenciables.
8. Verificar receipts y outcomes fuera del texto del agente.
9. Actualizar scorecard.
10. Mantener la autonomía en `ask` salvo promoción explícita por política.

## Prohibiciones

- más de dos niveles de delegación;
- loops sin máximo;
- iniciar trabajo sin preflight;
- usar memoria como verdad operacional;
- inventar evidencia o costos;
- ejecutar una capability no declarada;
- modificar una propuesta durante su revisión independiente;
- promover autonomía desde una afirmación del agente;
- incluir IDs, fechas o señales volátiles dentro del prefijo KV estable;
- realizar escrituras externas desde la skill.

## Evidencia de salida

- plan estructurado;
- preflight persistido;
- work session;
- refs de evidencia y outputs;
- gasto registrado;
- scorecard;
- receipts cuando exista ejecución verificable.
