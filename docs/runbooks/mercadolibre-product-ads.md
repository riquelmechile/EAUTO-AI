# MercadoLibre Product Ads v2 — Runbook operativo

## Alcance

Este runbook activa exclusivamente el read plane Product Ads de Plasticov. No habilita `ads.update`, no modifica campañas y no alimenta costos unitarios del Profit Engine.

## Configuración pendiente

En el servidor productivo:

```dotenv
MELI_PRODUCT_ADS_ENABLED=true
MELI_PRODUCT_ADS_ACCOUNT_ID=plasticov
MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON={}
MELI_PRODUCT_ADS_TIMEOUT_MS=30000
MELI_PRODUCT_ADS_MAX_RESPONSE_BYTES=2000000
MELI_PRODUCT_ADS_MAXIMUM_RANGE_DAYS=90
```

El mapping puede permanecer vacío únicamente para el primer discovery. Si MercadoLibre devuelve más de un advertiser MLC, el sync falla de forma intencional. En ese caso configure el ID elegido:

```dotenv
MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON={"plasticov":"<ADVERTISER_ID>"}
```

No suba el advertiser ID ni credenciales reales a Git cuando formen parte de la configuración privada del negocio.

## Validación previa

```bash
npm run check
npm audit --audit-level=high
npm run doctor:production -- --env=.env.production
npm run smoke:production-runtime
```

## Primer sync

Use un rango corto y explícito, por ejemplo un día:

```http
POST /v1/integrations/mercadolibre/product-ads/sync
Authorization: Bearer <operator-token>
Content-Type: application/json

{
  "accountId": "plasticov",
  "dateFrom": "2026-07-28",
  "dateTo": "2026-07-28"
}
```

Después revise:

- `/v1/integrations/mercadolibre/product-ads/campaigns`;
- `/v1/integrations/mercadolibre/product-ads/ad-groups`;
- `/v1/integrations/mercadolibre/product-ads/items`;
- `/v1/integrations/mercadolibre/product-ads/reconciliations`.

## Criterios de aceptación live

Durante cinco días hábiles consecutivos:

1. compare campañas, Ad Groups e ítems con la interfaz Product Ads;
2. confirme que el rango y las métricas corresponden al mismo período;
3. documente cualquier `price-drift`, `missing-listing` o `missing-profitability`;
4. confirme que `adsCostMinor` solo aparece cuando el ítem trae métricas directas;
5. no convierta gasto de campaña o Ad Group en costo unitario sin una policy comercial versionada.

## Rollback

Desactive el read plane sin alterar OAuth ni otros read models:

```dotenv
MELI_PRODUCT_ADS_ENABLED=false
```

El historial persistido permanece disponible para auditoría; no se realizan escrituras remotas ni rollback externo.
