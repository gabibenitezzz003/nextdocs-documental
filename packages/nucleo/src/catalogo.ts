import { conexion } from '@docvance/db';
import {
  claveComparacion,
  normalizarComprobante,
  normalizarCuit,
  normalizarPatente,
  texto,
  type ObjetoNegocio,
} from '@docvance/dominio';

const MAXIMO_CANDIDATOS = 40;
const MAXIMO_CLAVES = 60;

interface FilaObjeto {
  id: string;
  tipo: string;
  clave_externa: string;
  etiqueta: string;
  atributos: Record<string, unknown>;
}

function clavesDeBusqueda(valores: Record<string, unknown>): string[] {
  const encontradas = new Set<string>();

  for (const bruto of Object.values(valores)) {
    if (bruto === null || bruto === undefined) continue;
    if (typeof bruto === 'object') continue;

    const plano = texto(bruto);
    if (plano.length < 3) continue;

    for (const variante of [
      claveComparacion(plano),
      normalizarComprobante(plano),
      normalizarCuit(plano),
      normalizarPatente(plano),
    ]) {
      if (variante) encontradas.add(claveComparacion(variante));
    }
  }

  return [...encontradas].slice(0, MAXIMO_CLAVES);
}

function aObjetoNegocio(fila: FilaObjeto): ObjetoNegocio {
  return {
    ...fila.atributos,
    tipo: fila.tipo,
    id: fila.id,
    etiqueta: fila.etiqueta,
    claveExterna: fila.clave_externa,
  };
}

export async function buscarObjetosDeNegocio(
  inquilinoId: string,
  valores: Record<string, unknown>,
): Promise<ObjetoNegocio[]> {
  const claves = clavesDeBusqueda(valores);
  if (!claves.length) return [];

  const { rows } = await conexion().query<FilaObjeto>(
    `SELECT o.id, o.tipo, o.clave_externa, o.etiqueta, o.atributos
       FROM objeto_negocio o
      WHERE o.inquilino_id = $1
        AND o.estado = 'ABIERTO'
        AND EXISTS (
          SELECT 1
            FROM jsonb_each_text(o.atributos) AS atributo(clave, valor)
           WHERE regexp_replace(upper(atributo.valor), '[^A-Z0-9]', '', 'g') = ANY($2::text[])
        )
      ORDER BY o.actualizado_en DESC
      LIMIT $3`,
    [inquilinoId, claves, MAXIMO_CANDIDATOS],
  );

  return rows.map(aObjetoNegocio);
}
