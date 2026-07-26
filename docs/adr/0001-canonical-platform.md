# ADR 0001: EAUTO-AI como plataforma canónica

## Estado

Aceptado.

## Contexto

MSL y kiiess contienen capacidades solapadas y complementarias. Mantener dos organizaciones agénticas separadas duplica contratos, memoria, workers, políticas y deuda operacional.

## Decisión

EAUTO-AI será el repositorio canónico. Las capacidades se migrarán como puertos y adaptadores, sin copiar árboles completos ni mantener dos implementaciones equivalentes.

La primera arquitectura usa:

- TypeScript y npm workspaces.
- Expo SDK 57 / React Native 0.86 para Android.
- Fastify 5 para API.
- Postgres como verdad autoritativa.
- Redis para runtime efímero.
- Object storage para assets.
- LLM y proveedores creativos detrás de puertos.

## Consecuencias

- MSL y kiiess continúan como fuentes de migración hasta alcanzar paridad.
- Cada capability requiere inventario, pruebas de paridad, migración y deprecación.
- No se promete producción real de MercadoLibre hasta conectar adaptadores y credenciales con smoke verificable.
