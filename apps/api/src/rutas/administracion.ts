import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { TIPOS_EVENTO } from '@nextdocs/contratos';
import { conexion, provisionarInquilino } from '@nextdocs/db';

import { ErrorApi } from '../problemas.js';

const esquemaProvision = z.object({
  inquilinoId: z.string().uuid(),
  nombre: z.string().trim().min(1).max(200),
});

const esquemaSuscripcion = z.object({
  inquilinoId: z.string().uuid().optional(),
  claveApi: z.string().trim().min(8).max(200).optional(),
  url: z.string().trim().url().max(500),
  secreto: z.string().trim().min(16).max(200).optional(),
  tiposEvento: z.array(z.enum(TIPOS_EVENTO)).default([]),
});

function clavePlataforma(): string | null {
  return process.env['ADMIN_CLAVE']?.trim() || null;
}

function credencialValida(pedido: FastifyRequest): boolean {
  const esperada = clavePlataforma();
  if (!esperada) return false;

  const cabecera = pedido.headers.authorization;
  const recibida =
    typeof cabecera === 'string' && cabecera.toLowerCase().startsWith('bearer ')
      ? cabecera.slice(7).trim()
      : null;
  if (!recibida) return false;

  const recibidaBuf = Buffer.from(recibida);
  const esperadaBuf = Buffer.from(esperada);
  return recibidaBuf.length === esperadaBuf.length && timingSafeEqual(recibidaBuf, esperadaBuf);
}

export async function rutasDeAdministracion(servidor: FastifyInstance): Promise<void> {
  servidor.post('/api/v1/admin/inquilinos', async (pedido, respuesta) => {
    if (!credencialValida(pedido)) {
      throw new ErrorApi('NO_AUTENTICADO', 'La credencial de plataforma no es valida.');
    }

    const datos = esquemaProvision.parse(pedido.body);
    const clave = `ndk_${randomBytes(24).toString('hex')}`;

    await provisionarInquilino(datos.inquilinoId, datos.nombre, clave);

    pedido.log.info({ inquilinoId: datos.inquilinoId }, 'inquilino provisionado por plataforma');
    respuesta.status(201);
    return { inquilinoId: datos.inquilinoId, clave };
  });

  servidor.post('/api/v1/admin/suscripciones', async (pedido, respuesta) => {
    if (!credencialValida(pedido)) {
      throw new ErrorApi('NO_AUTENTICADO', 'La credencial de plataforma no es valida.');
    }

    const datos = esquemaSuscripcion.parse(pedido.body);
    const secreto = datos.secreto ?? `whk_${randomBytes(24).toString('hex')}`;

    let inquilinoId = datos.inquilinoId ?? null;
    if (!inquilinoId && datos.claveApi) {
      const { rows: claves } = await conexion().query<{ inquilino_id: string }>(
        `SELECT inquilino_id FROM clave_api WHERE huella = $1 AND activa`,
        [createHash('sha256').update(datos.claveApi).digest('hex')],
      );
      inquilinoId = claves[0]?.inquilino_id ?? null;
    }
    if (!inquilinoId) {
      throw new ErrorApi('VALIDACION_FALLIDA', 'No se pudo resolver el inquilino de la suscripcion.');
    }

    const { rows } = await conexion().query<{ id: string; inquilino_id: string }>(
      `INSERT INTO suscripcion_webhook (inquilino_id, url, secreto, tipos_evento)
       SELECT i.id, $2, $3, $4 FROM inquilino i WHERE i.id = $1
       ON CONFLICT (inquilino_id, url)
       DO UPDATE SET secreto = EXCLUDED.secreto, tipos_evento = EXCLUDED.tipos_evento,
                     estado = 'ACTIVA'
       RETURNING id, inquilino_id`,
      [inquilinoId, datos.url, secreto, datos.tiposEvento],
    );

    const fila = rows[0];
    if (!fila) {
      throw new ErrorApi('VALIDACION_FALLIDA', 'El inquilino indicado no existe.');
    }

    pedido.log.info({ inquilinoId: fila.inquilino_id, url: datos.url }, 'suscripcion registrada por plataforma');
    respuesta.status(201);
    return { id: fila.id, inquilinoId: fila.inquilino_id, url: datos.url, secreto };
  });

  servidor.delete('/api/v1/admin/suscripciones', async (pedido, respuesta) => {
    if (!credencialValida(pedido)) {
      throw new ErrorApi('NO_AUTENTICADO', 'La credencial de plataforma no es valida.');
    }

    const datos = z
      .object({ inquilinoId: z.string().uuid(), url: z.string().trim().url().max(500) })
      .parse(pedido.body);

    const { rowCount } = await conexion().query(
      'DELETE FROM suscripcion_webhook WHERE inquilino_id = $1 AND url = $2',
      [datos.inquilinoId, datos.url],
    );

    respuesta.status(200);
    return { eliminadas: rowCount ?? 0 };
  });
}
