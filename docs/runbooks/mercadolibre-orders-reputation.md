# MercadoLibre Chile — órdenes y reputación read-only

## Alcance

Este slice incorpora órdenes y reputación agregada para Plasticov y Maustian. Mantiene la separación por seller y reutiliza OAuth, cifrado, refresh rotatorio y leases del runtime MercadoLibre Chile.

No se persiste:

- comprador;
- email o teléfono;
- documentos tributarios;
- datos de facturación;
- dirección de entrega;
- mensajes;
- información de pago sensible.

No se cancelan órdenes, no se actualizan envíos y no se ejecuta ninguna mutación.

## Datos de órdenes conservados

- ID y estado.
- fechas de creación, cierre y última actualización.
- moneda, monto total y monto pagado cuando exista.
- cantidad de ítems y unidades.
- IDs de publicaciones.
- pack ID y shipping ID opcionales.
- tags operativos.
- hash de la representación normalizada.

## Reputación conservada

- seller y site `MLC`.
- nivel y power seller opcionales.
- período de medición.
- transacciones totales, completadas y canceladas.
- proporción positiva, neutral y negativa.
- fecha de observación y hash.

## Endpoints remotos

- `GET /orders/search?seller=<sellerId>` con paginación y orden descendente por fecha.
- `GET /users/<sellerId>` para reputación agregada.

Las órdenes disponibles dependen de la ventana que MercadoLibre exponga para la cuenta. El read model no debe interpretarse como histórico contable completo.

## API interna

- `POST /v1/integrations/mercadolibre/:accountId/commercial-operations/sync`
- `GET /v1/integrations/mercadolibre/:accountId/orders`
- `GET /v1/integrations/mercadolibre/:accountId/reputation`

Toda respuesta de sincronización declara `writesPerformed=false`.

## Android

La pestaña `Ventas` muestra, por cuenta:

- órdenes observadas;
- órdenes pagadas y canceladas;
- monto bruto en CLP;
- nivel de reputación;
- power seller;
- transacciones completadas;
- una lista compacta de órdenes recientes sin PII.

## Verificación live

Para Plasticov y Maustian por separado:

1. Autorice ambas cuentas en staging.
2. Ejecute `Actualizar ventas`.
3. Compare el conteo y una muestra de IDs con el panel privado.
4. Compare reputación, nivel y power seller.
5. Confirme que el JSON no contiene buyer, contact, billing o address.
6. Confirme que sincronizar una cuenta no modifica la otra.
7. Confirme `writesPerformed=false`.

## Recuperación

- Error de payload: no reemplazar el snapshot anterior.
- Error de persistencia: rollback transaccional.
- Access token vencido: refresh bajo lease.
- Refresh revocado: estado `reauthorization-required`.
- Reputación con seller/site inesperado: rechazar todo el ciclo.

## Limitación económica

El monto mostrado es bruto observado, no beneficio. La verdad económica requiere costos de producto, comisiones, envío, publicidad, devoluciones, impuestos y reconciliación. Ese cálculo se implementa en un slice posterior y nunca debe inferirse solo desde `total_amount`.
