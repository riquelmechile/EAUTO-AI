# Readiness de release y producción

Este documento separa dos estados que no deben confundirse:

1. **release técnico reproducible**: el repositorio, sus artefactos y sus contratos pasan gates verificables de calidad, seguridad y build;
2. **producción comercial live**: la infraestructura real, las credenciales, MercadoLibre, los proveedores externos y los outcomes han sido observados y reconciliados fuera de CI.

Una etiqueta o un GitHub Release **no convierte por sí solo a EAUTO-AI en producción comercial**.

## Qué certifica `v0.1.0`

La primera release técnica puede publicarse únicamente cuando el commit exacto cumple todos estos gates internos:

- lockfile reproducible;
- auditoría de dependencias fail-closed mediante `npm run audit:ci`, con cualquier excepción explícita, acotada y expirable documentada en [Excepciones de seguridad](SECURITY_EXCEPTIONS.md);
- Prettier, TypeScript estricto y ESLint;
- suite de tests y cobertura mínima configurada;
- build de servidor y Android;
- contratos MercadoLibre modelados en CI;
- generación y validación de credenciales sin imprimir secretos;
- paridad de capacidades sin estados parciales declarados;
- `doctor:production` sobre la plantilla productiva;
- smokes PostgreSQL, idempotencia, migraciones y object storage ejecutados por CI;
- Compose y Caddy válidos;
- imagen de runtime construible;
- workflows de supply chain fijados a commits SHA;
- review del candidato exacto antes del merge.

La release de contenedor conserva SBOM, provenance y digest inmutable. El flujo Android espera un build EAS finalizado y trabaja con su build ID exacto cuando se ejecuta esa etapa.

## Qué `v0.1.0` no certifica

La release técnica no demuestra por sí sola:

- DNS/TLS productivo real;
- secretos de proveedores instalados correctamente en un servidor real;
- OAuth, refresh tokens o webhooks reales de MercadoLibre;
- Product Ads reconciliado contra la cuenta real;
- cinco días hábiles de comparación de read models;
- dos semanas de `question.answer` en modo `ask` con aprobación manual;
- instalación del AAB firmado en un dispositivo físico;
- backup y restauración real de PostgreSQL;
- reinicio completo de workers sin pérdida de eventos en infraestructura real;
- proveedor visual real validado con `phash-64`;
- sesión LLM shadow con costo y evidencia real;
- outcome económico real reconciliado;
- condiciones para promover una capability a `inform` o `autonomous`.

La fuente de verdad para esos gates es el issue [#41 — production: complete live MercadoLibre and deployment gates](https://github.com/riquelmechile/EAUTO-AI/issues/41). Debe permanecer abierto hasta que exista evidencia sanitizada de cada requisito.

## Camino de release

### 1. Candidato

Todo cambio de release entra por una rama y PR desde `main`. El candidato se identifica por su SHA exacto; no por el nombre de la rama.

### 2. Gate de calidad

En local puede ejecutarse:

```bash
npm ci
npm run audit:ci
npm run format:check
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
npm run doctor
```

GitHub Actions agrega PostgreSQL real, migraciones, idempotencia, Compose, Caddy, Docker, object storage, credentials doctor y production doctor.

### 3. Review verificable

No se fusiona un candidato material sin review. Si el SHA cambia después de la revisión, el receipt anterior deja de representar el candidato y debe repetirse el gate.

### 4. Merge y `main`

Después del merge se vuelve a exigir CI verde sobre el commit de `main` resultante. Ese SHA es la base de la release.

### 5. Tag y artefactos

`v0.1.0` debe apuntar al commit validado de `main`. El workflow de release puede producir:

- imagen multi-arquitectura en GHCR;
- digest inmutable;
- SBOM y provenance;
- AAB mediante EAS cuando las credenciales de esa etapa estén configuradas;
- envío opcional a Google Play solo mediante el build ID exacto.

No se usa `latest` como evidencia de despliegue ni `--latest` para seleccionar el AAB.

## Camino de producción live

El orden operacional recomendado es deliberadamente conservador:

1. configurar dominios, TLS y secretos reales;
2. ejecutar `credentials:doctor` y `doctor:production` contra valores reales;
3. conectar Plasticov primero;
4. observar OAuth refresh y webhook real autenticado/deduplicado;
5. reconciliar read models y Product Ads durante la ventana definida en #41;
6. operar `question.answer` en `ask` y comparar receipts con respuestas publicadas;
7. completar restore drill, reinicio de workers y validación del AAB físico;
8. validar proveedores externos y una sesión LLM shadow;
9. reconciliar el primer outcome económico real;
10. recién después evaluar los requisitos temporales para aumentar autonomía.

Maustian no se usa como atajo para saltarse la validación inicial de Plasticov.

## Evidencia aceptable

La evidencia de producción debe ser suficiente para reconstruir qué ocurrió sin exponer secretos ni datos personales de compradores. Ejemplos:

- SHA de commit y run ID de GitHub Actions;
- digest de imagen;
- build ID de EAS;
- timestamps y IDs de receipts sanitizados;
- logs sanitizados de refresh/webhook;
- resultado de backup/restore;
- comparación de conteos o hashes de read models;
- outcome económico reconciliado con su referencia de evidencia.

Nunca adjuntar tokens, contraseñas, claves privadas, cookies, datos personales de compradores ni archivos `.env` reales.

## Rollback y recuperación

- El runtime se despliega por digest inmutable, no por tag mutable.
- Los fallos remotos no verificados terminan en `uncertain`; no se reintentan ciegamente.
- Las migraciones productivas se tratan como forward-only: la recuperación se diseña con corrección posterior y restore probado, no con una reversión improvisada del esquema.
- La publicación Android usa un build ID exacto y auditable.
- La promoción de autonomía requiere rollback probado y outcomes reales, además de la ventana temporal definida en #41.

## Runbooks relacionados

- [Release de producción](runbooks/production-release.md)
- [Credenciales](runbooks/credentials.md)
- [Excepciones de seguridad](SECURITY_EXCEPTIONS.md)
- [Proveedores de producción](PRODUCTION_PROVIDERS.md)
- [Seguridad e identidad](SECURITY_AND_IDENTITY.md)
- [Política de autonomía](AUTONOMY_POLICY.md)
- [Roadmap](ROADMAP.md)
