# Contributing

## Flujo

1. Crear issue/spec para cambios no triviales.
2. Trabajar en una rama descriptiva.
3. Implementar un slice vertical pequeño.
4. Ejecutar `npm run check`.
5. Abrir PR con evidencia, riesgos y rollback.

## Commits

Usar Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`.

## Reglas

- No introducir datos ficticios en rutas productivas.
- No silenciar typecheck/lint para dejar CI verde.
- No ejecutar mutaciones externas desde tests.
- No almacenar secretos.
- No modificar una acción después de su aprobación sin invalidar la aprobación.
