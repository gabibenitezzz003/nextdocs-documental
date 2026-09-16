import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { CODIGOS_ERROR, type CodigoError, type ProblemaHttp } from '@nextdocs/contratos';

const TITULOS: Record<string, string> = {
  DOCUMENTO_NO_ENCONTRADO: 'El documento no existe',
  ACCESO_DENEGADO_INQUILINO: 'El recurso pertenece a otro inquilino',
  TRANSICION_INVALIDA: 'La transicion de estado no esta permitida',
  PLANTILLA_NO_PUBLICADA: 'No hay plantilla publicada',
  REVISION_REQUERIDA: 'El documento necesita revision humana',
  EMPAREJAMIENTO_AMBIGUO: 'Hay mas de un candidato posible',
  VALIDACION_FALLIDA: 'Los datos enviados no son validos',
  CONFLICTO_CONCURRENCIA: 'Otro proceso modifico el recurso',
  ARCHIVO_RECHAZADO: 'El archivo no se puede procesar',
  INTEGRACION_NO_DISPONIBLE: 'La integracion no responde',
  NO_AUTENTICADO: 'Falta la credencial',
  SIN_PERMISO: 'El rol no habilita esta operacion',
  ERROR_INTERNO: 'Error interno',
};

const ESTADOS: Record<string, number> = {
  DOCUMENTO_NO_ENCONTRADO: 404,
  ACCESO_DENEGADO_INQUILINO: 403,
  TRANSICION_INVALIDA: 409,
  PLANTILLA_NO_PUBLICADA: 409,
  REVISION_REQUERIDA: 409,
  EMPAREJAMIENTO_AMBIGUO: 409,
  VALIDACION_FALLIDA: 422,
  CONFLICTO_CONCURRENCIA: 409,
  ARCHIVO_RECHAZADO: 415,
  INTEGRACION_NO_DISPONIBLE: 503,
  NO_AUTENTICADO: 401,
  SIN_PERMISO: 403,
  ERROR_INTERNO: 500,
};

export class ErrorApi extends Error {
  readonly codigo: string;
  readonly detalles: unknown;

  constructor(codigo: CodigoError | 'NO_AUTENTICADO' | 'SIN_PERMISO' | 'ERROR_INTERNO', detalle: string, detalles?: unknown) {
    super(detalle);
    this.name = 'ErrorApi';
    this.codigo = codigo;
    this.detalles = detalles ?? null;
  }
}

export function noEncontrado(detalle: string): ErrorApi {
  return new ErrorApi(CODIGOS_ERROR.DOCUMENTO_NO_ENCONTRADO, detalle);
}

function armarProblema(codigo: string, detalle: string, correlacionId: string, instancia: string): ProblemaHttp {
  return {
    tipo: `https://nextdocsia.fenixgroup.tech/problemas/${codigo.toLowerCase()}`,
    titulo: TITULOS[codigo] ?? TITULOS['ERROR_INTERNO'] ?? 'Error',
    estado: ESTADOS[codigo] ?? 500,
    detalle,
    codigo,
    instancia,
    correlacionId,
  };
}

export function registrarManejadorDeErrores(servidor: FastifyInstance): void {
  servidor.setNotFoundHandler((pedido: FastifyRequest, respuesta: FastifyReply) => {
    const problema = armarProblema(
      'DOCUMENTO_NO_ENCONTRADO',
      `No hay ruta ${pedido.method} ${pedido.url}.`,
      pedido.correlacionId,
      pedido.url,
    );
    respuesta.status(404).type('application/problem+json').send(problema);
  });

  servidor.setErrorHandler((error: Error, pedido: FastifyRequest, respuesta: FastifyReply) => {
    if (error instanceof ZodError) {
      const problema = armarProblema(
        CODIGOS_ERROR.VALIDACION_FALLIDA,
        'Revisa los campos rechazados.',
        pedido.correlacionId,
        pedido.url,
      );
      respuesta.status(422).type('application/problem+json').send({ ...problema, campos: error.issues });
      return;
    }

    if (error instanceof ErrorApi) {
      const problema = armarProblema(error.codigo, error.message, pedido.correlacionId, pedido.url);
      respuesta.status(problema.estado).type('application/problem+json').send(
        error.detalles ? { ...problema, detalles: error.detalles } : problema,
      );
      return;
    }

    pedido.log.error({ err: error, correlacionId: pedido.correlacionId }, 'fallo no controlado');

    const problema = armarProblema('ERROR_INTERNO', 'Ocurrio un error inesperado.', pedido.correlacionId, pedido.url);
    respuesta.status(500).type('application/problem+json').send(problema);
  });
}
