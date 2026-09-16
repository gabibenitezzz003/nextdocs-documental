import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  esquemaCargarDocumento,
  esquemaConfirmarEmparejamiento,
  esquemaListado,
  esquemaRevision,
} from '@nextdocs/contratos';
import {
  DocumentoInexistente,
  RevisionInvalida,
  confirmarEmparejamiento,
  recibirDocumento,
  revisarDocumento,
} from '@nextdocs/nucleo';
import { NOMBRE_COLA_PROCESAMIENTO } from '@nextdocs/contratos';
import { TransicionInvalida } from '@nextdocs/dominio';

import { exigirPermiso } from '../contexto.js';
import { bandeja, bitacora, ficha, resumenPorEstado } from '../consultas.js';
import { dependencias } from '../dependencias.js';
import { ErrorApi, noEncontrado } from '../problemas.js';

const esquemaId = z.object({ id: z.string().uuid() });

const ESTADOS_REPROCESABLES = ['RECIBIDO', 'OBSERVADO'];

function traducir(error: unknown): never {
  if (error instanceof DocumentoInexistente) throw noEncontrado(error.message);
  if (error instanceof TransicionInvalida) throw new ErrorApi('TRANSICION_INVALIDA', error.message);
  if (error instanceof RevisionInvalida) {
    throw new ErrorApi(error.codigo as 'VALIDACION_FALLIDA', error.message);
  }
  throw error;
}

export async function rutasDeDocumentos(servidor: FastifyInstance): Promise<void> {
  servidor.post('/api/v1/documentos', async (pedido, respuesta) => {
    exigirPermiso(pedido.contexto, 'cargar');

    const datos = esquemaCargarDocumento.parse(pedido.body);
    const claveIdempotencia = pedido.headers['idempotency-key'];

    const resultado = await recibirDocumento(
      {
        inquilinoId: pedido.contexto.inquilinoId,
        datos,
        actor: pedido.contexto.actor,
        claveIdempotencia: typeof claveIdempotencia === 'string' ? claveIdempotencia : null,
        correlacionId: pedido.correlacionId,
      },
      dependencias(),
    );

    if (!resultado.aceptado && resultado.motivo === 'ARCHIVO_RECHAZADO') {
      throw new ErrorApi('ARCHIVO_RECHAZADO', 'El archivo no paso los controles de entrada.', resultado.rechazos);
    }

    if (!resultado.aceptado && resultado.motivo === 'DUPLICADO') {
      respuesta.status(200);
      return { ...resultado, correlacionId: pedido.correlacionId };
    }

    respuesta.status(202).header('location', `/api/v1/documentos/${resultado.documentoId}`);
    return { ...resultado, correlacionId: pedido.correlacionId };
  });

  servidor.get('/api/v1/documentos', async (pedido) => {
    exigirPermiso(pedido.contexto, 'leer');
    const filtro = esquemaListado.parse(pedido.query);
    return bandeja(pedido.contexto.inquilinoId, filtro);
  });

  servidor.get('/api/v1/documentos/resumen', async (pedido) => {
    exigirPermiso(pedido.contexto, 'leer');
    return { porEstado: await resumenPorEstado(pedido.contexto.inquilinoId) };
  });

  servidor.get('/api/v1/documentos/:id', async (pedido) => {
    exigirPermiso(pedido.contexto, 'leer');
    const { id } = esquemaId.parse(pedido.params);
    const encontrada = await ficha(pedido.contexto.inquilinoId, id);
    if (!encontrada) throw noEncontrado(`No existe el documento ${id}.`);
    return encontrada;
  });

  servidor.get('/api/v1/documentos/:id/original', async (pedido) => {
    exigirPermiso(pedido.contexto, 'leer');
    const { id } = esquemaId.parse(pedido.params);
    const encontrada = await ficha(pedido.contexto.inquilinoId, id);
    if (!encontrada?.archivo) throw noEncontrado(`No hay original guardado para ${id}.`);

    const clave = String(encontrada.archivo['clave_almacen']);
    const url = await dependencias().almacenamiento.urlFirmada(clave, 300);
    return { url, expiraEnSegundos: 300 };
  });

  servidor.get('/api/v1/documentos/:id/bitacora', async (pedido) => {
    exigirPermiso(pedido.contexto, 'leer');
    const { id } = esquemaId.parse(pedido.params);
    const encontrada = await ficha(pedido.contexto.inquilinoId, id);
    if (!encontrada) throw noEncontrado(`No existe el documento ${id}.`);
    return { entradas: await bitacora(pedido.contexto.inquilinoId, id) };
  });

  servidor.post('/api/v1/documentos/:id/revisiones', async (pedido) => {
    exigirPermiso(pedido.contexto, 'revisar');
    const { id } = esquemaId.parse(pedido.params);
    const cuerpo = esquemaRevision.parse(pedido.body);

    if (cuerpo.decision === 'APROBAR') exigirPermiso(pedido.contexto, 'aprobar');

    try {
      return await revisarDocumento({
        inquilinoId: pedido.contexto.inquilinoId,
        documentoId: id,
        decision: cuerpo.decision,
        claveCampo: cuerpo.claveCampo ?? null,
        valor: cuerpo.valor,
        motivo: cuerpo.motivo ?? null,
        actor: pedido.contexto.actor,
        correlacionId: pedido.correlacionId,
      });
    } catch (error) {
      return traducir(error);
    }
  });

  servidor.post('/api/v1/documentos/:id/emparejamiento', async (pedido) => {
    exigirPermiso(pedido.contexto, 'revisar');
    const { id } = esquemaId.parse(pedido.params);
    const cuerpo = esquemaConfirmarEmparejamiento.parse(pedido.body);

    try {
      return await confirmarEmparejamiento({
        inquilinoId: pedido.contexto.inquilinoId,
        documentoId: id,
        candidatoId: cuerpo.candidatoId,
        motivo: cuerpo.motivo ?? null,
        actor: pedido.contexto.actor,
        correlacionId: pedido.correlacionId,
      });
    } catch (error) {
      return traducir(error);
    }
  });

  servidor.post('/api/v1/documentos/:id/reprocesar', async (pedido, respuesta) => {
    exigirPermiso(pedido.contexto, 'cargar');
    const { id } = esquemaId.parse(pedido.params);
    const encontrada = await ficha(pedido.contexto.inquilinoId, id);
    if (!encontrada) throw noEncontrado(`No existe el documento ${id}.`);

    const estado = String(encontrada.documento['estado']);
    if (!ESTADOS_REPROCESABLES.includes(estado)) {
      throw new ErrorApi(
        'TRANSICION_INVALIDA',
        `Un documento en ${estado} no se puede reprocesar. Solo ${ESTADOS_REPROCESABLES.join(' o ')}.`,
      );
    }

    await dependencias().encolar(NOMBRE_COLA_PROCESAMIENTO, `${id}-${Date.now()}`, {
      documentoId: id,
      inquilinoId: pedido.contexto.inquilinoId,
      correlacionId: pedido.correlacionId,
      intento: 1,
    });

    respuesta.status(202);
    return { documentoId: id, encolado: true, correlacionId: pedido.correlacionId };
  });
}
