import { cerrarColas, cerrarRedis, trabajador } from '@docvance/adaptadores';
import { NOMBRE_COLA_PROCESAMIENTO } from '@docvance/contratos';
import { cerrar } from '@docvance/db';

import { procesar, type TrabajoProcesamiento } from './procesador.js';
import { publicarPendientes } from './publicador.js';

const CONCURRENCIA = Number(process.env['WORKER_CONCURRENCIA'] ?? 2);
const RITMO_MAXIMO = Number(process.env['WORKER_RITMO_MAXIMO'] ?? 6);
const RITMO_VENTANA_MS = Number(process.env['WORKER_RITMO_VENTANA_MS'] ?? 60_000);
const CADENCIA_PUBLICACION_MS = Number(process.env['WORKER_CADENCIA_MS'] ?? 3_000);

function registrar(mensaje: string, datos?: Record<string, unknown>): void {
  const linea = { momento: new Date().toISOString(), mensaje, ...datos };
  process.stdout.write(`${JSON.stringify(linea)}\n`);
}

const consumidor = trabajador<TrabajoProcesamiento>(
  NOMBRE_COLA_PROCESAMIENTO,
  async (trabajo) => {
    const resultado = await procesar(trabajo);
    registrar('documento procesado', {
      documentoId: resultado.documentoId,
      estado: resultado.estado,
      confianza: resultado.confianza,
      motivo: resultado.motivo,
    });
    return resultado;
  },
  CONCURRENCIA,
  { maximo: RITMO_MAXIMO, ventanaMs: RITMO_VENTANA_MS },
);

consumidor.on('failed', (trabajo, error) => {
  registrar('fallo el procesamiento', {
    documentoId: trabajo?.data.documentoId ?? null,
    intento: trabajo?.attemptsMade ?? null,
    error: error.message,
  });
});

let publicando = false;

const reloj = setInterval(() => {
  if (publicando) return;
  publicando = true;

  publicarPendientes()
    .then((resumen) => {
      if (resumen.revisados) registrar('bandeja de salida', { ...resumen });
    })
    .catch((error: Error) => {
      registrar('fallo la publicacion', { error: error.message });
    })
    .finally(() => {
      publicando = false;
    });
}, CADENCIA_PUBLICACION_MS);

async function apagar(senal: string): Promise<void> {
  registrar('apagando el worker', { senal });
  clearInterval(reloj);
  await consumidor.close();
  await cerrarColas();
  await cerrarRedis();
  await cerrar();
  process.exit(0);
}

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    void apagar(senal);
  });
}

registrar('worker arriba', {
  cola: NOMBRE_COLA_PROCESAMIENTO,
  concurrencia: CONCURRENCIA,
  ritmo: `${RITMO_MAXIMO} cada ${RITMO_VENTANA_MS / 1000}s`,
  cadenciaMs: CADENCIA_PUBLICACION_MS,
});
