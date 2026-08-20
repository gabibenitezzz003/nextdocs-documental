import 'fastify';

import type { ContextoInquilino } from './contexto.js';

declare module 'fastify' {
  interface FastifyRequest {
    correlacionId: string;
    contexto: ContextoInquilino;
  }
}
