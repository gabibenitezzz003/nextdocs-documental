import { entregarEvento, eventosPendientes } from '@docvance/nucleo';

const TIEMPO_LIMITE_MS = 10_000;

export async function enviarPorHttp(
  url: string,
  cuerpo: string,
  encabezados: Record<string, string>,
): Promise<number> {
  const cortar = AbortSignal.timeout(TIEMPO_LIMITE_MS);

  try {
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...encabezados },
      body: cuerpo,
      signal: cortar,
    });
    return respuesta.status;
  } catch {
    return 0;
  }
}

export interface ResumenPublicacion {
  revisados: number;
  entregados: number;
  fallidos: number;
}

export async function publicarPendientes(limite = 50): Promise<ResumenPublicacion> {
  const pendientes = await eventosPendientes(limite);
  let entregados = 0;
  let fallidos = 0;

  for (const eventoId of pendientes) {
    const resultado = await entregarEvento(eventoId, enviarPorHttp);
    if (resultado.entregado) entregados += 1;
    else fallidos += 1;
  }

  return { revisados: pendientes.length, entregados, fallidos };
}
