import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { conexion } from '@docvance/db';

import { exigirPermiso } from '../contexto.js';
import { ErrorApi, noEncontrado } from '../problemas.js';

const esquemaId = z.object({ id: z.string().uuid() });

const esquemaDestinatario = z.object({
  nombre: z.string().min(2).max(120),
  correo: z.string().email().max(160),
  familias: z.array(z.string().max(20)).max(10).default([]),
  plantillas: z.array(z.string().max(40)).max(20).default([]),
  situaciones: z.array(z.enum(['APROBADO', 'OBSERVADO', 'RECHAZADO', 'VENCIDO', 'POR_VENCER']))
    .min(1)
    .max(5)
    .default(['APROBADO']),
  activo: z.boolean().default(true),
});

const esquemaEnvios = z.object({
  estado: z.enum(['PENDIENTE', 'ENVIADO', 'FALLIDO']).default('ENVIADO'),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

export async function rutasDeDistribucion(servidor: FastifyInstance): Promise<void> {
  servidor.get('/api/v1/destinatarios', async (pedido) => {
    exigirPermiso(pedido.contexto, 'leer');

    const { rows } = await conexion().query(
      `SELECT id, nombre, correo, familias, plantillas, situaciones, activo, creado_en
         FROM destinatario_documental
        WHERE inquilino_id = $1
        ORDER BY nombre`,
      [pedido.contexto.inquilinoId],
    );

    return { destinatarios: rows };
  });

  servidor.post('/api/v1/destinatarios', async (pedido, respuesta) => {
    exigirPermiso(pedido.contexto, 'administrar');
    const datos = esquemaDestinatario.parse(pedido.body);

    const { rows } = await conexion().query(
      `INSERT INTO destinatario_documental
         (inquilino_id, nombre, correo, familias, plantillas, situaciones, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (inquilino_id, correo)
       DO UPDATE SET nombre = EXCLUDED.nombre,
                     familias = EXCLUDED.familias,
                     plantillas = EXCLUDED.plantillas,
                     situaciones = EXCLUDED.situaciones,
                     activo = EXCLUDED.activo
       RETURNING id, nombre, correo, familias, plantillas, situaciones, activo`,
      [
        pedido.contexto.inquilinoId,
        datos.nombre,
        datos.correo.toLowerCase(),
        datos.familias.map((f) => f.toUpperCase()),
        datos.plantillas.map((p) => p.toUpperCase()),
        datos.situaciones,
        datos.activo,
      ],
    );

    respuesta.status(201);
    return rows[0];
  });

  servidor.delete('/api/v1/destinatarios/:id', async (pedido, respuesta) => {
    exigirPermiso(pedido.contexto, 'administrar');
    const { id } = esquemaId.parse(pedido.params);

    const { rowCount } = await conexion().query(
      'DELETE FROM destinatario_documental WHERE id = $1 AND inquilino_id = $2',
      [id, pedido.contexto.inquilinoId],
    );

    if (!rowCount) throw noEncontrado(`No existe el destinatario ${id}.`);

    respuesta.status(204);
    return null;
  });

  servidor.get('/api/v1/envios', async (pedido) => {
    exigirPermiso(pedido.contexto, 'leer');
    const filtro = esquemaEnvios.parse(pedido.query);

    const { rows } = await conexion().query(
      `SELECT e.id, e.destinatario, e.asunto, e.motivo, e.estado, e.intentos,
              e.ultimo_error, e.creado_en, e.enviado_en,
              d.nombre_archivo, d.plantilla_codigo
         FROM envio_documental e
         JOIN documento d ON d.id = e.documento_id
        WHERE e.inquilino_id = $1 AND e.estado = $2
        ORDER BY coalesce(e.enviado_en, e.creado_en) DESC
        LIMIT $3`,
      [pedido.contexto.inquilinoId, filtro.estado, filtro.limite],
    );

    return { envios: rows };
  });

  servidor.post('/api/v1/documentos/:id/enviar', async (pedido, respuesta) => {
    exigirPermiso(pedido.contexto, 'revisar');
    const { id } = esquemaId.parse(pedido.params);

    const cuerpo = z
      .object({ correo: z.string().email().max(160) })
      .parse(pedido.body);

    const { rows } = await conexion().query<{ estado: string; nombre_archivo: string }>(
      'SELECT estado, nombre_archivo FROM documento WHERE id = $1 AND inquilino_id = $2',
      [id, pedido.contexto.inquilinoId],
    );

    const documento = rows[0];
    if (!documento) throw noEncontrado(`No existe el documento ${id}.`);

    if (documento.estado === 'RECIBIDO' || documento.estado === 'PROCESANDO') {
      throw new ErrorApi('TRANSICION_INVALIDA', 'El documento todavia se esta procesando.');
    }

    await conexion().query(
      `INSERT INTO envio_documental
         (inquilino_id, documento_id, destinatario, asunto, motivo)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (documento_id, destinatario, motivo)
       DO UPDATE SET estado = 'PENDIENTE', intentos = 0, ultimo_error = NULL`,
      [
        pedido.contexto.inquilinoId,
        id,
        cuerpo.correo.toLowerCase(),
        `${documento.estado === 'APROBADO' ? 'Documento aprobado' : 'Documento'}: ${documento.nombre_archivo}`,
        documento.estado,
      ],
    );

    respuesta.status(202);
    return { documentoId: id, destinatario: cuerpo.correo, encolado: true };
  });
}
