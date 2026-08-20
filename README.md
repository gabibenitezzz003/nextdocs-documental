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
pnpm build
pnpm dev
```

El sembrado deja una clave de API de demostracion y la imprime en pantalla. Con esa
clave ya podes cargar documentos:

```bash
curl http://localhost:4000/api/v1/documentos   -H "Authorization: Bearer <la clave que imprimio el sembrado>"
```

Ademas de la clave hay credenciales de usuario para probar los roles:
`Bearer usuario:admin@demo.local`, `usuario:operador@demo.local` y
`usuario:revisor@demo.local`.

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
importa Fastify, Postgres ni ningún proveedor de IA: son reglas puras con tests
que corren en milisegundos.

La API no habla con el proveedor de IA. Recibe, guarda el original y encola. El
único proceso que llama al modelo es el worker.

## Proveedor de IA

Con `PROVEEDOR_IA=simulado` el motor devuelve lo que le hayan guionado los tests,
asi que sirve para probar el circuito completo sin gastar tokens, pero no lee el
documento de verdad.

Para leer documentos reales, en `.env`:

```
PROVEEDOR_IA=gemini
GOOGLE_API_KEY=<tu clave>
GEMINI_MODELO=gemini-2.0-flash
```

Y reiniciar el worker. La clave viaja en la cabecera `x-goog-api-key`, nunca en la
url.

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

## Tipos de documento

Once plantillas base, agrupadas por familia. Cada una declara sus campos, cuáles
son críticos, contra qué objeto de negocio empareja y qué reglas la validan.

| Familia | Plantillas |
|---|---|
| Fiscal | factura, nota de crédito, nota de débito, constancia de inscripción |
| Logístico | remito |
| Identidad | DNI, licencia de conducir |
| Vehicular | VTV, RTO, cédula del vehículo, póliza de seguro |

Las que declaran un campo de vencimiento avisan cuando el documento venció o
está por vencer. Los umbrales y la criticidad de cada campo se ajustan desde la
interfaz, sin tocar código.

## Constatación fiscal

Las facturas se verifican contra ARCA por el web service WSCDC, con
autenticación WSAA y firma CMS del ticket. Si ARCA rechaza el comprobante es
crítico, si lo observa es error, y si no se pudo consultar queda como
advertencia: nunca se aprueba fingiendo que se verificó.

Necesita un certificado digital de ARCA delegado al servicio `wscdc`. Sin él,
todo lo demás funciona igual.

## Aprender de las correcciones

Cada corrección humana se guarda por plantilla y por emisor. A partir de la
segunda vez que aparece el mismo error se corrige solo, queda anotado en los
hallazgos, y las correcciones frecuentes se le pasan al modelo como contexto.

Si el documento dice otra cosa, gana el documento.

## Estado

El núcleo, la API, el worker y la interfaz están construidos y probados. Ver
`docs/arquitectura/estado.md` para el detalle.

## Comandos

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integracion
pnpm build
```
