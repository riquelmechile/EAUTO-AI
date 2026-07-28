# Product Identification Android

La app Android incorpora un control plane para Product Identification sin trasladar autoridad al cliente.

## Flujo

1. seleccionar Plasticov o Maustian;
2. capturar o seleccionar una imagen;
3. subir y completar la verificación del objeto;
4. solicitar Product Identification;
5. inspeccionar ID, estado, policy, fingerprint, candidato, alternativas, duplicados y evidencia;
6. confirmar con Product ID explícito o rechazar con motivo;
7. conservar en pantalla la decisión terminal devuelta por el servidor.

## Autoridad

La aplicación no envía thresholds, policy, provider URL, reviewer, review ID ni timestamp. Tampoco publica, compra o modifica datos de MercadoLibre.

## Roles visibles

- `owner`, `admin`, `operator`: identificación;
- `owner`, `admin`, `reviewer`: confirmación o rechazo;
- el servidor mantiene la autorización final.
