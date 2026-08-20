# Levantar IA-Docs en tu maquina

Todo corre local: la base, la cola, el almacenamiento y la IA. En una hora lo
tenes andando y podes subir un remito de verdad.

## Que es esto

IA-Docs lee documentos —remitos, facturas, DNI, VTV, polizas— y saca los datos
con la IA, marcando de que parte del papel salio cada uno. Despues los valida,
los asocia al pedido o al camion que corresponde, y avisa lo que necesita que
alguien mire.

Son dos piezas. **DocVance** es el motor: este repositorio, que expone una API.
**IA-Docs** es la pantalla, y vive adentro de Follow como un modulo mas.

## Antes de empezar

| Que | Version | Por que |
|---|---|---|
| Node | 22 o mas | el repo usa `--env-file-if-exists`, que no existe en 20 |
| pnpm | 9.12 | sale con `corepack enable` |
| Docker Desktop | andando | levanta Postgres, Redis y MinIO |

**Tres cosas no estan en el repositorio a proposito, porque son credenciales.
Pedilas antes del paso 3:**

- La **clave de Gemini** es la unica obligatoria. Sin ella el sistema levanta
  pero no lee ningun documento.
- El **certificado de ARCA**, solo si vas a tocar la verificacion de facturas.
- El **token de Follow**, solo si vas a probar el emparejamiento contra choferes
  y vehiculos reales.

## El motor

### 1. Clonar e instalar

```bash
git clone https://github.com/gabibenitezzz003/docvance-ai.git
cd docvance-ai
corepack enable
pnpm install
```

Anduvo si termina sin errores y aparece `node_modules`.

### 2. Armar el archivo de configuracion

```bash
cp .env.ejemplo .env
```

Completa la clave de Gemini. Las demas lineas ya apuntan a los contenedores
locales, no las toques.

```
PROVEEDOR_IA=gemini
GOOGLE_API_KEY=<la que te pasaron>
GEMINI_MODELO=gemini-3.6-flash
```

### 3. Levantar la infraestructura

```bash
pnpm infra:arriba
```

Anduvo si `docker ps` muestra tres contenedores `docvance-*` en healthy.

### 4. Crear las tablas y los datos iniciales

```bash
pnpm db:migrar && pnpm db:sembrar
```

Deja un inquilino de prueba, tres usuarios con distintos roles, las once
plantillas de documento y la clave de API para probar. Te la imprime en
pantalla, copiala.

### 5. Compilar y arrancar

```bash
pnpm build
```

Dos terminales, una para cada proceso:

```bash
pnpm api
```

```bash
pnpm worker
```

La API recibe los documentos y los guarda. El worker es el unico que habla con
la IA. Si el worker no esta, los documentos entran pero se quedan esperando.

Anduvo si `curl http://localhost:4000/listo` devuelve `{"estado":"listo"}`.

## La pantalla

### 1. Pararte en la rama correcta

```bash
cd follow-front
git checkout feature/ia-docs-modulo
npm install
```

### 2. Conectarla con el motor

Al final del `.env` de `follow-front`:

```
VITE_IA_DOCS_URL=http://localhost:4000
VITE_IA_DOCS_CLAVE=<la clave que imprimio el sembrado>
```

Vite lee esas variables una sola vez, al arrancar. Si las editas con el servidor
prendido, el modulo va a decir que falta configurar el servicio aunque este todo
bien.

### 3. Arrancar

```bash
npm start
```

Entras por Cargas -> IA-Docs, o derecho a
`https://localhost:3000/carga/ia-docs`. El navegador te avisa del certificado
autofirmado: aceptalo y segui.

## Probar que anda de verdad

Entra a la Bandeja, toca Cargar documento y subi un remito o una factura en PDF
o foto.

En unos 50 segundos el worker lo levanta, se lo manda a la IA y vuelve leido.
Abrilo con el ojito: a la izquierda el original, a la derecha cada campo con su
confianza. **Hace clic en un campo y se resalta en el papel de donde lo saco.**
Eso es lo que hace que el sistema sea revisable y no una caja negra.

Es normal que quede en Observado: significa que lo leyo pero encontro algo que
necesita que un humano decida. El motivo esta en la solapa de Hallazgos.

## Que corre en cada puerto

| Servicio | Puerto | Para que |
|---|---|---|
| API | 4000 | documentacion viva en `/documentacion` |
| Follow | 3000 | la pantalla de IA-Docs |
| PostgreSQL | 5433 | estado y bitacora de auditoria |
| Redis | 6380 | la cola de procesamiento |
| MinIO | 9100 | los archivos originales |
| MinIO consola | 9101 | usuario y clave `docvance` / `docvance123` |

Los puertos estan corridos a proposito para no chocar con otros proyectos.

## Cuando algo falla

**El documento queda en Procesando y no avanza.** Mira la terminal del worker.
`429` es cuota de Gemini agotada, se reinicia al dia siguiente. `503` es Google
saturado y reintenta solo. En los dos casos el documento no se pierde: cuando se
agotan los reintentos queda en Observado y lo reencolas con el boton de la
flecha circular.

**Port 3000 is already in use.** Te quedo un servidor viejo dando vueltas:

```bash
Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

**El modulo dice que falta configurar el servicio.** Falta
`VITE_IA_DOCS_URL`, o la pusiste con el servidor prendido. Corta y volve a
arrancar.

**Los documentos entran pero nunca se procesan.** El worker no esta corriendo.
Es un proceso aparte de la API.

**Quiero borrar todo y empezar limpio.** `pnpm db:vaciar` borra documentos,
excepciones y envios, y deja las plantillas y los usuarios. Si queres tirar
tambien los volumenes de Docker, `pnpm infra:limpiar` y despues volves a migrar
y sembrar.

## Antes de tocar codigo

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Los tests de integracion corren contra una base aparte que se crea sola, y se
niegan a arrancar si no termina en `_pruebas`. Eso esta puesto porque borran
tablas, y una vez se llevaron puesta la base de desarrollo.

Dos reglas del proyecto que vas a notar enseguida: **el codigo esta en español**
—clases, funciones, variables— y **no lleva comentarios**. Si algo necesita
explicacion, va en el README o el nombre esta mal puesto.

---

Si algo no encaja con lo que dice esta guia, avisa y la corregimos. Es mas
rapido arreglar el documento una vez que explicarlo cada vez.
