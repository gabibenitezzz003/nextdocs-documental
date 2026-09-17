import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { provisionarInquilino } from '@nextdocs/db';

import { ErrorApi } from '../problemas.js';

const esquemaProvision = z.object({
  inquilinoId: z.string().uuid(),
  nombre: z.string().trim().min(1).max(200),
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
}
