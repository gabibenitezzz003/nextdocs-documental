# DocVance AI

Plataforma de inteligencia documental y automatización de procesos.

**Del documento a la acción.**

Convierte documentos físicos o digitales en datos estructurados con evidencia,
los valida, los asocia a un objeto de negocio y dispara la siguiente acción.

## Levantar en local

Necesitás Docker y Node 20 o superior.

```bash
corepack enable
pnpm install
cp .env.ejemplo .env
pnpm infra:arriba
pnpm db:migrar
pnpm db:sembrar
pnpm dev
```

| Servicio | Puerto | Para qué |
|---|---|---|
| API | 4000 | REST y OpenAPI |
| Web | 4001 | interfaz |
| PostgreSQL | 5433 | estado y auditoría |
| Redis | 6380 | colas y cache |
| MinIO | 9100 | originales |
| MinIO consola | 9101 | usuario docvance, clave docvance123 |

Los puertos están corridos a propósito para no chocar con otros proyectos.

Para bajar todo:

```bash
pnpm infra:abajo
```

Y si querés empezar de cero, borrando los volúmenes:

```bash
pnpm infra:limpiar
```

## Estructura

```
apps/
  api/         REST, autenticación, contexto de inquilino
  worker/      procesamiento asíncrono del pipeline
  web/         interfaz
packages/
  dominio/     reglas de negocio puras, sin framework
  contratos/   tipos y esquemas compartidos
  db/          esquema, migraciones y acceso a datos
infra/docker/  entorno local
docs/          arquitectura y decisiones
```

Las dependencias apuntan hacia el dominio, nunca al revés. `packages/dominio` no
importa nada de NestJS, Postgres ni ningún proveedor de IA: son reglas puras con
tests que corren en milisegundos.

## Invariantes

Estas se sostienen aunque cambien proveedores, pantallas o clientes:

- El documento original se preserva.
- Los datos extraídos quedan versionados con su corrida.
- Toda evidencia es trazable hasta la página y el recorte.
- La confianza es explícita, por campo.
- El emparejamiento es auditable y nunca se resuelve solo si hay ambigüedad.
- La revisión humana no destruye lo anterior.
- La instantánea de aprobación es inmutable.
- Cada inquilino está aislado.
- Las integraciones son idempotentes.
- Los fallos son recuperables.

## Estado

Fase 0 (fundación) e inicio de Fase 1. Ver `docs/arquitectura/estado.md` para el
detalle de qué está construido y qué falta.

## Comandos

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integracion
pnpm build
```
