import type { FastifyInstance } from 'fastify';

import { conexion } from '@nextdocs/db';

export async function rutasDeSalud(servidor: FastifyInstance): Promise<void> {
  servidor.get('/salud', async () => ({ estado: 'vivo', momento: new Date().toISOString() }));

  servidor.get('/listo', async (_pedido, respuesta) => {
    try {
      await conexion().query('SELECT 1');
      return { estado: 'listo', base: 'ok' };
    } catch (error) {
      respuesta.status(503);
      return { estado: 'no-listo', base: (error as Error).message };
    }
  });
}
