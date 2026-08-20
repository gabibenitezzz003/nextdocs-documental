import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { configuracion } from './configuracion.js';
import { registrarContexto } from './contexto.js';
import { registrarManejadorDeErrores } from './problemas.js';
import { rutasDeDocumentos } from './rutas/documentos.js';
import { rutasDeOpenapi } from './rutas/openapi.js';
import { rutasDeOperacion } from './rutas/operacion.js';
import { rutasDeSalud } from './rutas/salud.js';
import './tipos.js';

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function armarServidor(): Promise<FastifyInstance> {
  const ajustes = configuracion();

  const servidor = Fastify({
    logger: {
      level: process.env['LOG_NIVEL'] ?? 'info',
      redact: ['req.headers.authorization', 'req.headers["x-clave-api"]'],
    },
    bodyLimit: 40 * 1024 * 1024,
    genReqId: () => randomUUID(),
  });

  await servidor.register(cors, {
    origin: ajustes.origenesPermitidos,
    credentials: true,
    exposedHeaders: ['x-correlacion-id', 'location'],
  });

  servidor.addHook('onRequest', async (pedido, respuesta) => {
    const entrante = pedido.headers['x-correlacion-id'];
    pedido.correlacionId = typeof entrante === 'string' && FORMATO_UUID.test(entrante)
      ? entrante
      : String(pedido.id);
    respuesta.header('x-correlacion-id', pedido.correlacionId);
  });

  registrarManejadorDeErrores(servidor);
  registrarContexto(servidor);

  await servidor.register(rutasDeSalud);
  await servidor.register(rutasDeOpenapi);
  await servidor.register(rutasDeDocumentos);
  await servidor.register(rutasDeOperacion);

  return servidor;
}
