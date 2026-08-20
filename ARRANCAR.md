# Levantar todo en local

## Una sola vez

```bash
corepack enable
pnpm install
cp .env.ejemplo .env
```

En `.env` poné al menos `PROVEEDOR_IA=gemini` y tu `GOOGLE_API_KEY`.

## Cada vez

Infraestructura (Postgres, Redis, MinIO):

```bash
pnpm infra:arriba
```

Base de datos:

```bash
pnpm db:migrar && pnpm db:sembrar
```

API y worker, cada uno en su terminal:

```bash
pnpm api
```

```bash
pnpm worker
```

## Servicios de apoyo

| Qué | Comando | Dónde se ve |
|---|---|---|
| n8n | `docker compose -f ../follow-docker/n8n/local/docker-compose.yml up -d` | http://localhost:5678 |
| Buzón de correo | `docker compose -f ../follow-docker/correo-local/docker-compose.yml up -d` | http://localhost:8025 |
| Redis de Follow | `docker compose -f ../follow-docker/redis-local/docker-compose.yml up -d` | http://localhost:5540 |

## La interfaz

IA-Docs vive dentro de Follow, en la rama `feature/ia-docs-modulo`:

```bash
cd ../follow-front && npm start
```

Después entrás por **Cargas → IA-Docs**, o directo a
`https://localhost:3000/carga/ia-docs`.

## Comprobar que anda

```bash
curl http://localhost:4000/listo
```

```bash
curl http://localhost:4000/api/v1/vencimientos?dias=30 -H "Authorization: Bearer dvk_demo_4f2a9c7b1e6d8035a1c4b9e2f7d60831"
```

La documentación de la API está en http://localhost:4000/documentacion

## Correr las pruebas

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Las de integración van contra una base aparte que se crea sola, y se niegan a
correr si no termina en `_pruebas`:

```bash
pnpm --filter @docvance/nucleo test:integracion
```
