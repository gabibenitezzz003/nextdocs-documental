# B49 con documentos — el chofer manda una foto y el sistema responde

Dos flujos nuevos que conectan la conversación de WhatsApp con IA-Docs.

| Flujo | Id | Qué hace |
|---|---|---|
| `B49_DOCUMENTO_CHOFER` | `b49docchofer0001` | el chofer manda un remito, lo empuja a IA-Docs y le acusa recibo |
| `B49_RESULTADO_DOCUMENTO` | `b49docresult0001` | IA-Docs terminó de leerlo y decide qué contestarle |

## Por qué no reimplementamos el pipeline en n8n

`DV01_RECEPCION`, `DV02_INTELIGENCIA` y `DV03_ENTREGA` hacen lo mismo que ahora
hace la API de DocVance, pero sin transacciones, sin máquina de estados, sin
bitácora y sin instantánea inmutable. **Quedaron desactivados.**

El reparto es este:

- **n8n** maneja la conversación: cuándo escribirle al chofer, qué decirle, y no
  atosigarlo.
- **IA-Docs** maneja el documento: leerlo, validarlo, asociarlo y archivarlo.
- Se hablan por HTTP.

## B49_DOCUMENTO_CHOFER

Sub-workflow. Lo llama el router de WhatsApp cuando el mensaje trae un adjunto.

Entrada:

```json
{
  "telefono": "5492615551234",
  "tipoMime": "image/jpeg",
  "nombreArchivo": "remito.jpg",
  "contenidoBase64": "...",
  "idMensaje": "wamid.ABC"
}
```

Antes de mandar nada a IA-Docs controla que el teléfono sea válido, que el
archivo haya llegado, que el formato se pueda leer y que no pese más de 25 MB.
Si algo falla le contesta al chofer en criollo: *"Ese formato no lo puedo leer.
Mandame una foto o un PDF."*

El `idMensaje` de WhatsApp se usa como clave de idempotencia, así que si el
mismo mensaje entra dos veces no se crean dos documentos.

## B49_RESULTADO_DOCUMENTO

Webhook en `/webhook/b49-resultado-documento`. Lo llama IA-Docs cuando termina.

**La decisión importante es a quién le corresponde el problema.** No todo lo que
sale observado es culpa del chofer:

| Motivo | Quién lo resuelve | Qué pasa |
|---|---|---|
| foto ilegible, campos críticos sin leer, tipo no reconocido | **el chofer** | se le pide otra foto |
| remito sin conformar, CAE rechazado, sin emparejar | **el operador** | queda en el centro de excepciones |
| proveedor de IA saturado o caído | **nadie** | se reintenta solo |

Un motivo que no conocemos va al operador, nunca al chofer. Es preferible
molestar a un humano del equipo que mandarle un mensaje sin sentido a un chofer.

## Cuándo se calla

Comparte las claves de Redis con B42 y con el resto de B49, así el chofer tiene
una sola conversación:

| Clave | Para qué |
|---|---|
| `ai_paused:{tel}` | un operador tomó la conversación |
| `pending_question:{tel}` | otro agente tiene una pregunta abierta |
| `b49:documentos:v1:chofer:{tel}` | último aviso y cuántas veces insistimos por documento |

No le escribe si el bot está pausado, si otro agente está esperando respuesta, si
le escribimos hace menos de 10 minutos, o si ya le insistimos 3 veces por el
mismo documento.

## Nada apunta a producción por defecto

Las URLs salen de variables de entorno **sin respaldo**. Si `FOLLOW_WHATSAPP_URL`
no está configurada, el nodo falla en vez de caer en `panel.followlsn.com`.

Esto no era así: los flujos tenían la URL de producción como valor por defecto,
así que una prueba local podía mandarle un WhatsApp real a un chofer real.

En local, el compose apunta al simulador de la API de DocVance:

```
FOLLOW_WHATSAPP_URL=http://host.docker.internal:4000/api/v1/simulador/whatsapp
IA_DOCS_URL=http://host.docker.internal:4000
IA_DOCS_CLAVE=dvk_demo_...
```

Los mensajes simulados quedan en el log de la API, no salen a ningún lado.

## Probarlo

La lógica de decisión tiene 28 pruebas que corren sin n8n:

```bash
node probar_b49_documentos.js
```

Y el flujo entero, contra el n8n local:

```bash
curl -X POST http://localhost:5678/webhook/b49-resultado-documento \
  -H "content-type: application/json" \
  -d '{"tipoEvento":"documento.observado","agregadoId":"doc-1","datos":{"codigoMotivo":"CONFIANZA_GLOBAL_BAJA","telefonoChofer":"5492615551234"}}'
```

Comportamiento verificado:

- foto ilegible → le escribe al chofer pidiendo otra
- segundo aviso seguido → se frena con `RECIEN_LE_ESCRIBIMOS`
- documento aprobado → le agradece y le dice a qué pedido quedó asociado
- operador en la conversación → se frena con `BOT_PAUSADO`
- remito sin conformar → no le escribe, queda para el operador

## Lo que falta del lado de Follow

El puente de entrada todavía no existe. Hoy Follow **ya recibe** la foto del
chofer y la guarda como `ArchivoWsp` con su `mediaId`, pero nadie la baja ni se
la manda a IA-Docs.

Para cerrarlo hace falta que, cuando entra un `ArchivoWsp` con mime de imagen o
PDF, alguien baje los bytes con `WspMediaService.descargar` y llame a
`B49_DOCUMENTO_CHOFER`. Dos advertencias: el `mediaId` de Meta vence en minutos,
así que hay que bajarlo en el momento; y el webhook tiene que contestar 200
rápido, así que la descarga va en cola, nunca adentro del webhook.
