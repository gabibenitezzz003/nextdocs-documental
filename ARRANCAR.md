# Levantar todo en local

## Una sola vez

```bash
corepack enable
pnpm install
cp .env.ejemplo .env
```

En `.env` poné al menos `PROVEEDOR_IA=gemini` y tu `GOOGLE_API_KEY` si querés procesar documentos reales.

DocVance mantiene autenticación también en desarrollo. Definí una clave local propia:

```env
DOCVANCE_API_KEY=dvk_local_tu_clave_segura
```

`pnpm db:sembrar` registra la huella de esa clave en PostgreSQL. La clave nunca se guarda en texto plano en la base.

## Cada vez

Infraestructura (Postgres, Redis, MinIO):

```bash
pnpm infra:arriba
```

Base de datos:

```bash
pnpm db:migrar && pnpm db:sembrar
```

Si cambiaste `DOCVANCE_API_KEY`, volvé a ejecutar `pnpm db:sembrar` para registrar la nueva credencial.

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

### Llamar DocVance desde n8n en Docker

No uses `http://localhost:4000` desde un nodo HTTP de n8n: dentro del contenedor `localhost` apunta al propio contenedor.

Usá:

```text
http://host.docker.internal:4000/api/v1/documentos
```

con el header:

```text
Authorization: Bearer <valor de DOCVANCE_API_KEY>
```

Podés conservar `Idempotency-Key`; DocVance lo usa para hacer los reintentos seguros.

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
curl http://localhost:4000/api/v1/vencimientos?dias=30 -H "Authorization: Bearer $DOCVANCE_API_KEY"
```

En PowerShell:

```powershell
curl.exe http://localhost:4000/api/v1/vencimientos?dias=30 -H "Authorization: Bearer $env:DOCVANCE_API_KEY"
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

## Vaciar el modulo

Para mostrarlo sin datos de prueba adentro.

Borra documentos, excepciones, envios, eventos y bitacora. Deja el inquilino,
los usuarios, las plantillas y la clave de api:

```bash
pnpm db:limpiar
```

Lo mismo, y ademas borra los objetos de negocio de ejemplo y los destinatarios
de correo:

```bash
pnpm db:vaciar
```

Los archivos originales quedan huerfanos en MinIO. Son inofensivos porque
ninguna fila los referencia, pero si querés borrarlos tambien:

```bash
pnpm infra:limpiar && pnpm infra:arriba && pnpm db:migrar && pnpm db:sembrar
```

Eso borra los volumenes y arranca de cero.

## Sembrar sin datos de demostracion

El sembrado crea ocho documentos con vencimiento para que la pestaña de
vigencias no se vea vacia. Para que no los cree:

```bash
SEMBRAR_VIGENCIAS_DEMO=false pnpm db:sembrar
```

En PowerShell:

```bash
$env:SEMBRAR_VIGENCIAS_DEMO="false"; pnpm db:sembrar
```

Los seis objetos de negocio de ejemplo (pedidos, cliente, vehiculo, orden de
compra, proveedor) siguen creandose: sin ellos el emparejamiento no tiene contra
que comparar y todos los documentos quedan sin asociar.

Para tambien sacarlos, sembra y despues corre `pnpm db:vaciar`.
