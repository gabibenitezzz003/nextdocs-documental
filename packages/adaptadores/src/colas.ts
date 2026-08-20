import { Queue, Worker, type Processor } from 'bullmq';
import { Redis } from 'ioredis';

let conexionRedis: Redis | null = null;

export function redis(): Redis {
  if (conexionRedis === null) {
    const url = process.env['REDIS_URL'];
    if (!url) throw new Error('Falta la variable REDIS_URL.');
    conexionRedis = new Redis(url, { maxRetriesPerRequest: null });
  }
  return conexionRedis;
}

export async function cerrarRedis(): Promise<void> {
  if (conexionRedis !== null) {
    await conexionRedis.quit();
    conexionRedis = null;
  }
}

const colas = new Map<string, Queue>();

export function cola(nombre: string): Queue {
  let existente = colas.get(nombre);
  if (!existente) {
    existente = new Queue(nombre, {
      connection: redis(),
      defaultJobOptions: {
        attempts: 6,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 2000 },
      },
    });
    colas.set(nombre, existente);
  }
  return existente;
}

export function trabajador<T>(
  nombre: string,
  proceso: Processor<T>,
  concurrencia = 4,
): Worker<T> {
  return new Worker<T>(nombre, proceso, { connection: redis(), concurrency: concurrencia });
}

export async function encolar(
  nombre: string,
  clave: string,
  datos: Record<string, unknown>,
): Promise<void> {
  await cola(nombre).add(nombre, datos, { jobId: clave });
}

export async function cerrarColas(): Promise<void> {
  for (const c of colas.values()) await c.close();
  colas.clear();
}
