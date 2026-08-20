import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { esquemaResolverExcepcion } from '@docvance/contratos';
import { DocumentoInexistente, resolverExcepcion } from '@docvance/nucleo';

import {
  colaDeExcepciones,
  eventosDeSalida,
  plantillasPublicadas,
  resumenDeVencimientos,
  vencimientos,
} from '../consultas.js';
import { exigirPermiso } from '../contexto.js';
import { noEncontrado } from '../problemas.js';

const esquemaId = z.object({ id: z.string().uuid() });

const esquemaFiltroExcepciones = z.object({
  estado: z.string().max(20).optional(),
  severidad: z.string().max(20).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

const esquemaFiltroVencimientos = z.object({
  familia: z.string().max(20).optional(),
  plantilla: z.string().max(40).optional(),
  situacion: z.enum(['VENCIDO', 'POR_VENCER', 'VIGENTE']).optional(),
  dias: z.coerce.number().int().min(1).max(365).default(30),
  limite: z.coerce.number().int().min(1).max(500).default(200),
});

const esquemaFiltroEventos = z.object({
  estado: z.string().max(20).default('PENDIENTE'),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

export async function rutasDeOperacion(servidor: FastifyInstance): Promise<void> {
  servidor.get('/api/v1/excepciones', async (pedido) => {
    exigirPermiso(pedido.contexto, 'leer');
    const filtro = esquemaFiltroExcepciones.parse(pedido.query);
    return { excepciones: await colaDeExcepciones(pedido.contexto.inquilinoId, filtro) };
  });

  servidor.post('/api/v1/excepciones/:id/resolver', async (pedido) => {
    exigirPermiso(pedido.contexto, 'revisar');
    const { id } = esquemaId.parse(pedido.params);
    const cuerpo = esquemaResolverExcepcion.parse(pedido.body);

    try {
      return await resolverExcepcion({
        inquilinoId: pedido.contexto.inquilinoId,
        excepcionId: id,
        decision: cuerpo.decision,
        resolucion: cuerpo.resolucion,
        actor: pedido.contexto.actor,
        correlacionId: pedido.correlacionId,
      });
    } catch (error) {
      if (error instanceof DocumentoInexistente) throw noEncontrado(`No existe la excepcion ${id}.`);
      throw error;
    }
  });

  servidor.get('/api/v1/vencimientos', async (pedido) => {
    exigirPermiso(pedido.contexto, 'leer');
    const filtro = esquemaFiltroVencimientos.parse(pedido.query);

    const [documentos, resumen] = await Promise.all([
      vencimientos(pedido.contexto.inquilinoId, filtro),
      resumenDeVencimientos(pedido.contexto.inquilinoId, filtro.dias),
    ]);

    return { documentos, resumen, diasAviso: filtro.dias };
  });

  servidor.get('/api/v1/plantillas', async (pedido) => {
    exigirPermiso(pedido.contexto, 'leer');
    return { plantillas: await plantillasPublicadas(pedido.contexto.inquilinoId) };
  });

  servidor.get('/api/v1/eventos', async (pedido) => {
    exigirPermiso(pedido.contexto, 'leer');
    const filtro = esquemaFiltroEventos.parse(pedido.query);
    return {
      eventos: await eventosDeSalida(pedido.contexto.inquilinoId, filtro.estado, filtro.limite),
    };
  });

  servidor.post('/api/v1/simulador/erp', async (pedido) => {
    pedido.log.info(
      {
        firma: pedido.headers['x-docvance-firma'] ?? null,
        evento: pedido.headers['x-docvance-evento'] ?? null,
      },
      'el simulador de erp recibio un evento',
    );
    return { recibido: true };
  });
}
