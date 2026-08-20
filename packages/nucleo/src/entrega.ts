import { createHmac } from 'node:crypto';

import { conexion, enTransaccion } from '@docvance/db';
import type { SobreEvento } from '@docvance/contratos';

export interface ResultadoEntrega {
  eventoId: string;
  entregado: boolean;
  intentos: number;
  codigo: number | null;
  estado: string;
}

interface FilaEvento {
  id: string;
  inquilino_id: string;
  tipo_agregado: string;
  agregado_id: string;
  tipo_evento: string;
  version_evento: number;
  correlacion_id: string | null;
  causacion_id: string | null;
  contenido: Record<string, unknown>;
  intentos: number;
  creado_en: Date;
}

interface FilaSuscripcion {
  id: string;
  url: string;
  secreto: string;
  tipos_evento: string[];
}

export function firmar(secreto: string, marca: string, cuerpo: string): string {
  return createHmac('sha256', secreto).update(`${marca}.${cuerpo}`).digest('hex');
}

export function esperaDeReintento(intento: number): number {
  const base = Math.min(2 ** intento, 64) * 30;
  const ruido = Math.floor(Math.random() * 15);
  return (base + ruido) * 1000;
}

export function esReintentable(codigo: number): boolean {
  return codigo === 0 || codigo === 408 || codigo === 429 || codigo >= 500;
}

export function armarSobre(fila: FilaEvento): SobreEvento {
  return {
    eventoId: fila.id,
    tipoEvento: fila.tipo_evento as SobreEvento['tipoEvento'],
    versionEvento: fila.version_evento,
    ocurridoEn: fila.creado_en.toISOString(),
    inquilinoId: fila.inquilino_id,
    tipoAgregado: fila.tipo_agregado,
    agregadoId: fila.agregado_id,
    correlacionId: fila.correlacion_id,
    causacionId: fila.causacion_id,
    datos: fila.contenido,
  };
}

export async function entregarEvento(
  eventoSalidaId: string,
  enviar: (url: string, cuerpo: string, encabezados: Record<string, string>) => Promise<number>,
): Promise<ResultadoEntrega> {
  const { rows } = await conexion().query<FilaEvento>(
    'SELECT * FROM evento_salida WHERE id = $1',
    [eventoSalidaId],
  );
  const evento = rows[0];
  if (!evento) throw new Error(`No existe el evento ${eventoSalidaId}.`);

  const suscripciones = await conexion().query<FilaSuscripcion>(
    `SELECT id, url, secreto, tipos_evento FROM suscripcion_webhook
     WHERE inquilino_id = $1 AND estado = 'ACTIVA'`,
    [evento.inquilino_id],
  );

  const interesadas = suscripciones.rows.filter(
    (s) => s.tipos_evento.length === 0 || s.tipos_evento.includes(evento.tipo_evento),
  );

  if (interesadas.length === 0) {
    await conexion().query(
      `UPDATE evento_salida SET estado = 'SIN_SUSCRIPTORES', publicado_en = now() WHERE id = $1`,
      [eventoSalidaId],
    );
    return { eventoId: eventoSalidaId, entregado: true, intentos: evento.intentos, codigo: null, estado: 'SIN_SUSCRIPTORES' };
  }

  const cuerpo = JSON.stringify(armarSobre(evento));
  const marca = String(Math.floor(Date.now() / 1000));
  const intento = evento.intentos + 1;
  let todasBien = true;
  let ultimoCodigo = 0;

  for (const suscripcion of interesadas) {
    const encabezados = {
      'content-type': 'application/json',
      'x-docvance-evento': evento.tipo_evento,
      'x-docvance-evento-id': evento.id,
      'x-docvance-marca-tiempo': marca,
      'x-docvance-firma': firmar(suscripcion.secreto, marca, cuerpo),
      'idempotency-key': evento.id,
    };

    let codigo = 0;
    try {
      codigo = await enviar(suscripcion.url, cuerpo, encabezados);
    } catch {
      codigo = 0;
    }
    ultimoCodigo = codigo;
    const bien = codigo >= 200 && codigo < 300;
    if (!bien) todasBien = false;

    await conexion().query(
      `INSERT INTO entrega_webhook
         (inquilino_id, suscripcion_id, evento_id, intento, estado, codigo_respuesta)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (suscripcion_id, evento_id, intento) DO NOTHING`,
      [evento.inquilino_id, suscripcion.id, evento.id, intento, bien ? 'ENTREGADO' : 'FALLIDO', codigo],
    );
  }

  const agotado = intento >= 6;
  const reintentable = esReintentable(ultimoCodigo);
  let estado: string;

  if (todasBien) estado = 'PUBLICADO';
  else if (reintentable && !agotado) estado = 'PENDIENTE';
  else estado = 'FALLIDO';

  await enTransaccion(async (cliente) => {
    await cliente.query(
      `UPDATE evento_salida
       SET estado = $1, intentos = $2,
           proximo_intento_en = CASE WHEN $1 = 'PENDIENTE'
             THEN now() + ($3 || ' milliseconds')::interval ELSE proximo_intento_en END,
           publicado_en = CASE WHEN $1 = 'PUBLICADO' THEN now() ELSE publicado_en END,
           ultimo_error = CASE WHEN $1 = 'PUBLICADO' THEN NULL ELSE $4 END
       WHERE id = $5`,
      [estado, intento, String(esperaDeReintento(intento)), `codigo ${ultimoCodigo}`, eventoSalidaId],
    );
  });

  return { eventoId: eventoSalidaId, entregado: todasBien, intentos: intento, codigo: ultimoCodigo, estado };
}

export async function eventosPendientes(limite = 50): Promise<string[]> {
  const { rows } = await conexion().query<{ id: string }>(
    `SELECT id FROM evento_salida
     WHERE estado = 'PENDIENTE' AND proximo_intento_en <= now()
     ORDER BY creado_en ASC LIMIT $1`,
    [limite],
  );
  return rows.map((r) => r.id);
}
