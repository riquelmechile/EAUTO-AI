# EAUTO-AI

**Empresa agéntica autónoma de comercio, dirigida desde Android.**

EAUTO-AI es el repositorio canónico para fusionar la visión empresarial de MSL con el Agent OS local-first de kiiess. El sistema observa el negocio 24/7, despierta agentes solo cuando existe utilidad esperada, prepara contenido y acciones verificables, solicita aprobación según riesgo y aprende únicamente de outcomes comprobados.

## Doctrina

La arquitectura y el proceso de desarrollo siguen el libro completo:

- https://the-amazing-gentleman-programming-book.vercel.app/es

El libro se utiliza como doctrina de ingeniería, no como un bloque gigante reenviado al LLM. Sus principios se convierten en contratos, skills, gates, pruebas y recibos verificables.

## Estado de esta entrega

Esta rama implementa la **fundación vertical ejecutable**:

- Monorepo npm/TypeScript estricto.
- Dominio puro: cuentas, dinero, evidencia, acciones, autonomía, objetivos y contenido.
- Máquina de estados de acciones.
- Cadena append-only de recibos verificables mediante SHA-256.
- Compilador de prompts con prefijo estable para KV/prompt cache.
- Wake policy por señales y utilidad esperada.
- Costeo explícito de cache hit, cache miss y output en microUSD.
- API Fastify con health/readiness, dashboard, inbox, Content Studio y flujo propuesta → review → aprobación → ejecución → verificación.
- App Android Expo/React Native con panel de empresa, bandeja del CEO y captura de producto para Content Studio.
- Migraciones Postgres y outbox transaccional.
- Compose para Postgres, Redis, MinIO y API.
- Skills versionadas para lanzamiento, contenido, pricing y verdad financiera.
- Tests de dominio, arquitectura, caché, wake policy, recibos y acción completa.
- CI con formato, typecheck, lint, tests y build.

> Los adaptadores de MercadoLibre, LLM, imagen y video permanecen fail-closed. El proveedor de contenido incluido es un simulador trazable de desarrollo y declara que no realizó generación externa ni publicaciones.

## Requisitos

- Node.js 22.13 o superior.
- npm 10 o superior.
- Docker + Docker Compose para infraestructura local.
- Android Studio o EAS Build para compilar Android.

## Inicio rápido

```bash
npm install
npm run check
npm run dev:api
```

En otra terminal:

```bash
npm run dev:mobile
```

Android Emulator usa por defecto `http://10.0.2.2:3000`. Para un teléfono físico:

```bash
EXPO_PUBLIC_API_URL=http://IP_DE_TU_PC:3000 npm run dev:mobile
```

## Infraestructura local

```bash
docker compose -f infra/compose/docker-compose.yml up -d postgres redis minio
npm run doctor
```

## Endpoints

- `GET /health`
- `GET /ready`
- `GET /v1/dashboard`
- `GET /v1/inbox`
- `POST /v1/content/launches`
- `POST /v1/actions`
- `POST /v1/actions/:id/review`
- `POST /v1/actions/:id/approve`
- `POST /v1/actions/:id/execute`
- `GET /v1/actions/:id/receipts`

## Principios no negociables

1. No inventar datos faltantes.
2. El dominio no depende del LLM ni de frameworks.
3. Memoria no equivale a verdad operacional.
4. Aprobación no equivale a outcome.
5. API 200 no equivale a ejecución verificada: siempre debe existir lectura posterior.
6. Plasticov y Maustian permanecen aislados por cuenta.
7. La app Android es control plane; los workers 24/7 viven en backend persistente.
8. Toda acción sensible tiene evidence bundle, policy hash, aprobación y receipt chain.
9. El razonamiento se activa por utilidad esperada, no por round-robin ciego.
10. Las rutas productivas no usan fixtures silenciosos.

## Documentación

- [Visión de producto](docs/PRODUCT_VISION.md)
- [Arquitectura objetivo](docs/TARGET_ARCHITECTURE.md)
- [Política de autonomía](docs/AUTONOMY_POLICY.md)
- [Confianza verificable](docs/VERIFIABLE_TRUST.md)
- [Roadmap](docs/ROADMAP.md)
- [ADR del repositorio canónico](docs/adr/0001-canonical-platform.md)
