import type { FastifyInstance } from 'fastify';

import { CODIGOS_ERROR, LIMITES, TIPOS_ACEPTADOS, TIPOS_EVENTO } from '@nextdocs/contratos';

const PROBLEMA = {
  type: 'object',
  properties: {
    tipo: { type: 'string' },
    titulo: { type: 'string' },
    estado: { type: 'integer' },
    detalle: { type: 'string' },
    codigo: { type: 'string', enum: Object.values(CODIGOS_ERROR) },
    instancia: { type: 'string' },
    correlacionId: { type: 'string' },
  },
};

function respuestaProblema(descripcion: string): Record<string, unknown> {
  return {
    description: descripcion,
    content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problema' } } },
  };
}

function documento(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'NextDocs Documental',
      version: '1.0.0',
      description: 'Del documento a la accion. Recepcion, extraccion con evidencia, emparejamiento, revision humana y entrega de eventos.',
    },
    servers: [{ url: process.env['API_URL'] ?? 'http://localhost:4000' }],
    components: {
      securitySchemes: {
        claveApi: { type: 'http', scheme: 'bearer', description: 'Clave de API del inquilino.' },
      },
      schemas: {
        Problema: PROBLEMA,
        CargarDocumento: {
          type: 'object',
          required: ['nombreArchivo', 'contenidoBase64'],
          properties: {
            origen: { type: 'string', enum: ['API', 'WEB', 'EMAIL', 'SFTP', 'WHATSAPP', 'CONECTOR'] },
            nombreArchivo: { type: 'string', maxLength: LIMITES.nombreMaximo },
            tipoMime: { type: 'string', enum: Object.keys(TIPOS_ACEPTADOS) },
            contenidoBase64: { type: 'string' },
            referenciaExterna: { type: 'string', nullable: true },
            plantilla: { type: 'string', nullable: true },
          },
        },
        RespuestaCarga: {
          type: 'object',
          properties: {
            aceptado: { type: 'boolean' },
            documentoId: { type: 'string', format: 'uuid', nullable: true },
            estado: { type: 'string', nullable: true },
            motivo: { type: 'string' },
            duplicadoDe: { type: 'string', format: 'uuid' },
            correlacionId: { type: 'string' },
          },
        },
        Revision: {
          type: 'object',
          required: ['decision'],
          properties: {
            decision: { type: 'string', enum: ['CORREGIR', 'APROBAR', 'RECHAZAR'] },
            claveCampo: { type: 'string', nullable: true },
            valor: {},
            motivo: { type: 'string', nullable: true },
          },
        },
        ConfirmarEmparejamiento: {
          type: 'object',
          required: ['candidatoId'],
          properties: {
            candidatoId: { type: 'string', format: 'uuid' },
            motivo: { type: 'string', nullable: true },
          },
        },
        ResolverExcepcion: {
          type: 'object',
          required: ['decision', 'resolucion'],
          properties: {
            decision: { type: 'string', enum: ['RESUELTA', 'DESCARTADA', 'ESCALADA'] },
            resolucion: { type: 'string' },
          },
        },
      },
    },
    security: [{ claveApi: [] }],
    tags: [
      { name: 'documentos', description: 'Carga y consulta de documentos' },
      { name: 'revision', description: 'Intervencion humana' },
      { name: 'operacion', description: 'Excepciones, plantillas y eventos' },
      { name: 'salud', description: 'Sondas de vida' },
    ],
    paths: {
      '/salud': {
        get: {
          tags: ['salud'],
          summary: 'Responde si el proceso esta vivo',
          security: [],
          responses: { '200': { description: 'vivo' } },
        },
      },
      '/listo': {
        get: {
          tags: ['salud'],
          summary: 'Responde si la base contesta',
          security: [],
          responses: { '200': { description: 'listo' }, '503': { description: 'no listo' } },
        },
      },
      '/api/v1/documentos': {
        post: {
          tags: ['documentos'],
          summary: 'Carga un documento y lo encola para procesar',
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              schema: { type: 'string' },
              description: 'Reintentar con la misma clave devuelve el mismo documento.',
            },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CargarDocumento' } } },
          },
          responses: {
            '202': {
              description: 'aceptado y encolado',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/RespuestaCarga' } } },
            },
            '200': { description: 'ya existia por huella o por clave de idempotencia' },
            '415': respuestaProblema('archivo rechazado'),
            '422': respuestaProblema('cuerpo invalido'),
          },
        },
        get: {
          tags: ['documentos'],
          summary: 'Bandeja de documentos con cursor',
          parameters: [
            { name: 'estado', in: 'query', schema: { type: 'string' } },
            { name: 'plantilla', in: 'query', schema: { type: 'string' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limite', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          ],
          responses: { '200': { description: 'listado' } },
        },
      },
      '/api/v1/documentos/resumen': {
        get: {
          tags: ['documentos'],
          summary: 'Cuenta documentos por estado',
          responses: { '200': { description: 'conteo' } },
        },
      },
      '/api/v1/documentos/{id}': {
        get: {
          tags: ['documentos'],
          summary: 'Ficha completa con valores, evidencia, candidatos y excepciones',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'ficha' }, '404': respuestaProblema('no existe') },
        },
      },
      '/api/v1/documentos/{id}/original': {
        get: {
          tags: ['documentos'],
          summary: 'Devuelve una url firmada al archivo original',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'url temporal' }, '404': respuestaProblema('no existe') },
        },
      },
      '/api/v1/documentos/{id}/bitacora': {
        get: {
          tags: ['documentos'],
          summary: 'Bitacora de auditoria del documento',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'entradas' }, '404': respuestaProblema('no existe') },
        },
      },
      '/api/v1/documentos/{id}/revisiones': {
        post: {
          tags: ['revision'],
          summary: 'Corrige un campo, aprueba o rechaza el documento',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Revision' } } },
          },
          responses: {
            '200': { description: 'revision registrada' },
            '409': respuestaProblema('transicion invalida'),
            '404': respuestaProblema('no existe'),
          },
        },
      },
      '/api/v1/documentos/{id}/emparejamiento': {
        post: {
          tags: ['revision'],
          summary: 'Confirma a mano el objeto de negocio',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ConfirmarEmparejamiento' } } },
          },
          responses: { '200': { description: 'confirmado' }, '409': respuestaProblema('candidato ajeno') },
        },
      },
      '/api/v1/documentos/{id}/reprocesar': {
        post: {
          tags: ['documentos'],
          summary: 'Vuelve a encolar un documento que quedo en RECIBIDO',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '202': { description: 'encolado' }, '409': respuestaProblema('estado invalido') },
        },
      },
      '/api/v1/excepciones': {
        get: {
          tags: ['operacion'],
          summary: 'Cola de excepciones ordenada por prioridad y vencimiento',
          parameters: [
            { name: 'estado', in: 'query', schema: { type: 'string' } },
            { name: 'severidad', in: 'query', schema: { type: 'string' } },
            { name: 'limite', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'cola' } },
        },
      },
      '/api/v1/excepciones/{id}/resolver': {
        post: {
          tags: ['operacion'],
          summary: 'Cierra, descarta o escala una excepcion',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ResolverExcepcion' } } },
          },
          responses: { '200': { description: 'resuelta' }, '404': respuestaProblema('no existe') },
        },
      },
      '/api/v1/plantillas': {
        get: {
          tags: ['operacion'],
          summary: 'Plantillas publicadas del inquilino',
          responses: { '200': { description: 'plantillas' } },
        },
      },
      '/api/v1/eventos': {
        get: {
          tags: ['operacion'],
          summary: 'Eventos de la bandeja de salida',
          parameters: [
            { name: 'estado', in: 'query', schema: { type: 'string', enum: ['PENDIENTE', 'PUBLICADO', 'FALLIDO'] } },
            { name: 'limite', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': {
              description: `tipos posibles: ${TIPOS_EVENTO.join(', ')}`,
            },
          },
        },
      },
    },
  };
}

const PAGINA = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>NextDocs Documental</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0 } rapi-doc { height: 100vh }</style>
  </head>
  <body>
    <rapi-doc spec-url="/openapi.json" theme="dark" render-style="read" show-header="false"></rapi-doc>
    <script type="module" src="https://unpkg.com/rapidoc/dist/rapidoc-min.js"></script>
  </body>
</html>`;

export async function rutasDeOpenapi(servidor: FastifyInstance): Promise<void> {
  servidor.get('/openapi.json', async () => documento());

  servidor.get('/documentacion', async (_pedido, respuesta) => {
    respuesta.type('text/html');
    return PAGINA;
  });
}
