import type { PoolClient } from 'pg';

import { conexion } from '@nextdocs/db';
import {
  claveComparacion,
  hallazgo,
  normalizarCuit,
  texto,
  type Hallazgo,
  type Plantilla,
  type ValorExtraido,
} from '@nextdocs/dominio';

export const EMISOR_GENERICO = '*';
export const MAXIMO_PISTAS = 12;
export const VECES_PARA_APLICAR = 2;

export interface CorreccionAprendida {
  claveCampo: string;
  valorLeido: string;
  valorCorregido: unknown;
  veces: number;
}

export function claveDeEmisor(valores: Record<string, ValorExtraido>): string {
  const cuit = normalizarCuit(valores['cuitEmisor']?.valorNormalizado);
  if (cuit) return cuit;

  const razon = claveComparacion(valores['razonSocialEmisor']?.valorNormalizado);
  return razon || EMISOR_GENERICO;
}

export async function registrarCorreccion(
  cliente: PoolClient,
  entrada: {
    inquilinoId: string;
    plantillaCodigo: string;
    emisorClave: string;
    claveCampo: string;
    valorLeido: unknown;
    valorCorregido: unknown;
    documentoId: string;
  },
): Promise<void> {
  const leido = texto(entrada.valorLeido);
  if (!leido) return;
  if (leido === texto(entrada.valorCorregido)) return;

  await cliente.query(
    `INSERT INTO correccion_aprendida
       (inquilino_id, plantilla_codigo, emisor_clave, clave_campo, valor_leido,
        valor_corregido, ultimo_documento_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (inquilino_id, plantilla_codigo, emisor_clave, clave_campo, valor_leido)
     DO UPDATE SET valor_corregido = EXCLUDED.valor_corregido,
                   veces = correccion_aprendida.veces + 1,
                   ultimo_documento_id = EXCLUDED.ultimo_documento_id,
                   actualizado_en = now()`,
    [
      entrada.inquilinoId,
      entrada.plantillaCodigo,
      entrada.emisorClave,
      entrada.claveCampo,
      leido,
      JSON.stringify(entrada.valorCorregido ?? null),
      entrada.documentoId,
    ],
  );
}

export async function correccionesDe(
  inquilinoId: string,
  plantillaCodigo: string,
  emisorClave: string,
): Promise<CorreccionAprendida[]> {
  const { rows } = await conexion().query<{
    clave_campo: string;
    valor_leido: string;
    valor_corregido: unknown;
    veces: number;
  }>(
    `SELECT clave_campo, valor_leido, valor_corregido, veces
       FROM correccion_aprendida
      WHERE inquilino_id = $1
        AND plantilla_codigo = $2
        AND emisor_clave IN ($3, $4)
      ORDER BY veces DESC, actualizado_en DESC
      LIMIT 200`,
    [inquilinoId, plantillaCodigo, emisorClave, EMISOR_GENERICO],
  );

  return rows.map((r) => ({
    claveCampo: r.clave_campo,
    valorLeido: r.valor_leido,
    valorCorregido: r.valor_corregido,
    veces: Number(r.veces),
  }));
}

export interface ResultadoAprendizaje {
  valores: Record<string, ValorExtraido>;
  hallazgos: Hallazgo[];
  aplicadas: number;
}

export function aplicarCorrecciones(
  valores: Record<string, ValorExtraido>,
  correcciones: CorreccionAprendida[],
): ResultadoAprendizaje {
  if (!correcciones.length) return { valores, hallazgos: [], aplicadas: 0 };

  const ajustados: Record<string, ValorExtraido> = { ...valores };
  const hallazgos: Hallazgo[] = [];
  let aplicadas = 0;

  for (const correccion of correcciones) {
    if (correccion.veces < VECES_PARA_APLICAR) continue;

    const actual = ajustados[correccion.claveCampo];
    if (!actual) continue;

    const leidoAhora = claveComparacion(actual.valorLeido ?? actual.valorNormalizado);
    if (!leidoAhora) continue;
    if (leidoAhora !== claveComparacion(correccion.valorLeido)) continue;
    if (texto(actual.valorNormalizado) === texto(correccion.valorCorregido)) continue;

    ajustados[correccion.claveCampo] = {
      ...actual,
      valorNormalizado: correccion.valorCorregido,
    };

    aplicadas += 1;
    hallazgos.push(
      hallazgo(
        'CORREGIDO_POR_APRENDIZAJE',
        'info',
        `Se aplico una correccion aprendida en ${correccion.claveCampo}: "${correccion.valorLeido}" se venia corrigiendo a "${texto(correccion.valorCorregido)}" (${correccion.veces} veces).`,
        [correccion.claveCampo],
        'sistema',
      ),
    );
  }

  return { valores: ajustados, hallazgos, aplicadas };
}

export function pistasDeExtraccion(
  plantilla: Plantilla,
  correcciones: CorreccionAprendida[],
): string[] {
  const claves = new Set(plantilla.campos.map((c) => c.clave));

  return correcciones
    .filter((c) => claves.has(c.claveCampo))
    .slice(0, MAXIMO_PISTAS)
    .map(
      (c) =>
        `En ${c.claveCampo}, cuando el documento parece decir "${c.valorLeido}" el valor correcto suele ser "${texto(c.valorCorregido)}".`,
    );
}

export async function pistasParaEmisor(
  inquilinoId: string,
  plantilla: Plantilla,
  emisorClave: string,
): Promise<string[]> {
  const correcciones = await correccionesDe(inquilinoId, plantilla.codigo, emisorClave);
  return pistasDeExtraccion(plantilla, correcciones);
}
