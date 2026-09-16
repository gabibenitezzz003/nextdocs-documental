import { conexion } from '@nextdocs/db';

export interface FilaBandeja {
  id: string;
  estado: string;
  origen: string;
  plantilla_codigo: string | null;
  nombre_archivo: string;
  referencia_externa: string | null;
  confianza: string | null;
  sujeto_tipo: string | null;
  sujeto_id: string | null;
  creado_en: Date;
  actualizado_en: Date;
  familia: string | null;
  vence_en: string | null;
  documento_padre_id: string | null;
  excepciones_abiertas: string;
}

export interface Bandeja {
  documentos: FilaBandeja[];
  cursor: string | null;
}

export interface FiltroBandeja {
  estado?: string | undefined;
  plantilla?: string | undefined;
  cursor?: string | undefined;
  limite: number;
}

export async function bandeja(inquilinoId: string, filtro: FiltroBandeja): Promise<Bandeja> {
  const condiciones = ['d.inquilino_id = $1'];
  const parametros: unknown[] = [inquilinoId];

  if (filtro.estado) {
    parametros.push(filtro.estado.toUpperCase());
    condiciones.push(`d.estado = $${parametros.length}`);
  }

  if (filtro.plantilla) {
    parametros.push(filtro.plantilla.toUpperCase());
    condiciones.push(`d.plantilla_codigo = $${parametros.length}`);
  }

  if (filtro.cursor) {
    parametros.push(filtro.cursor);
    condiciones.push(`d.creado_en < $${parametros.length}`);
  }

  parametros.push(filtro.limite + 1);

  const { rows } = await conexion().query<FilaBandeja>(
    `SELECT d.id, d.estado, d.origen, d.plantilla_codigo, d.nombre_archivo, d.referencia_externa,
            d.confianza, d.sujeto_tipo, d.sujeto_id, d.creado_en, d.actualizado_en,
            d.familia, d.vence_en, d.documento_padre_id,
            (SELECT count(*) FROM excepcion e
              WHERE e.documento_id = d.id AND e.estado = 'ABIERTA') AS excepciones_abiertas
       FROM documento d
      WHERE ${condiciones.join(' AND ')}
      ORDER BY d.creado_en DESC
      LIMIT $${parametros.length}`,
    parametros,
  );

  const hayMas = rows.length > filtro.limite;
  const documentos = hayMas ? rows.slice(0, filtro.limite) : rows;
  const ultimo = documentos[documentos.length - 1];

  return {
    documentos,
    cursor: hayMas && ultimo ? ultimo.creado_en.toISOString() : null,
  };
}

export async function resumenPorEstado(inquilinoId: string): Promise<Record<string, number>> {
  const { rows } = await conexion().query<{ estado: string; total: string }>(
    'SELECT estado, count(*) AS total FROM documento WHERE inquilino_id = $1 GROUP BY estado',
    [inquilinoId],
  );
  return Object.fromEntries(rows.map((r) => [r.estado, Number(r.total)]));
}

export interface Ficha {
  documento: Record<string, unknown>;
  items: Record<string, unknown>[];
  hijos: Record<string, unknown>[];
  archivo: Record<string, unknown> | null;
  corrida: Record<string, unknown> | null;
  valores: Record<string, unknown>[];
  candidatos: Record<string, unknown>[];
  validacion: Record<string, unknown> | null;
  excepciones: Record<string, unknown>[];
  revisiones: Record<string, unknown>[];
  instantanea: Record<string, unknown> | null;
  fisico: Record<string, unknown> | null;
}

export async function ficha(inquilinoId: string, documentoId: string): Promise<Ficha | null> {
  const { rows: documentos } = await conexion().query<Record<string, unknown>>(
    `SELECT id, inquilino_id, origen, referencia_externa, huella, tipo_mime, nombre_archivo,
            estado, plantilla_codigo, sujeto_tipo, sujeto_id, confianza, version,
            familia, vence_en, documento_padre_id, pagina_desde, pagina_hasta,
            creado_en, actualizado_en
       FROM documento WHERE id = $1 AND inquilino_id = $2`,
    [documentoId, inquilinoId],
  );

  const documento = documentos[0];
  if (!documento) return null;

  const { rows: archivos } = await conexion().query<Record<string, unknown>>(
    `SELECT clave_almacen, version, suma, tamano_bytes, paginas, creado_en
       FROM archivo_documento WHERE documento_id = $1 ORDER BY version DESC LIMIT 1`,
    [documentoId],
  );

  const { rows: corridas } = await conexion().query<Record<string, unknown>>(
    `SELECT id, plantilla_codigo, plantilla_version, proveedor, modelo, version_prompt,
            version_esquema, estado, iniciado_en, terminado_en, milisegundos, uso
       FROM corrida_extraccion WHERE documento_id = $1 ORDER BY creado_en DESC LIMIT 1`,
    [documentoId],
  );

  const corrida = corridas[0] ?? null;

  const { rows: valores } = corrida
    ? await conexion().query<Record<string, unknown>>(
        `SELECT clave, valor_leido, valor_normalizado, confianza, pagina, recorte, texto_fuente,
                presencia
           FROM valor_extraido WHERE corrida_id = $1 ORDER BY clave`,
        [corrida['id']],
      )
    : { rows: [] };

  const { rows: candidatos } = await conexion().query<Record<string, unknown>>(
    `SELECT id, tipo_objeto, objeto_id, referencia_externa, puntaje, metodo, estado, razones
       FROM candidato_emparejamiento WHERE documento_id = $1 ORDER BY puntaje DESC`,
    [documentoId],
  );

  const { rows: validaciones } = await conexion().query<Record<string, unknown>>(
    `SELECT id, version_reglas, resultado, hallazgos, iniciado_en, terminado_en
       FROM corrida_validacion WHERE documento_id = $1 ORDER BY terminado_en DESC LIMIT 1`,
    [documentoId],
  );

  const { rows: excepciones } = await conexion().query<Record<string, unknown>>(
    `SELECT id, codigo_motivo, severidad, prioridad, motivos, accion_sugerida, estado,
            vence_en, resolucion, creado_en, resuelto_en
       FROM excepcion WHERE documento_id = $1 ORDER BY creado_en DESC`,
    [documentoId],
  );

  const { rows: revisiones } = await conexion().query<Record<string, unknown>>(
    `SELECT r.id, r.clave_campo, r.decision, r.motivo, r.antes, r.despues, r.creado_en,
            u.nombre AS revisor
       FROM revision_documento r
       LEFT JOIN usuario u ON u.id = r.revisor_id
      WHERE r.documento_id = $1 ORDER BY r.creado_en DESC`,
    [documentoId],
  );

  const { rows: instantaneas } = await conexion().query<Record<string, unknown>>(
    `SELECT id, documento_version, sello, contenido, creado_en
       FROM instantanea_aprobacion WHERE documento_id = $1 ORDER BY creado_en DESC LIMIT 1`,
    [documentoId],
  );

  const { rows: fisicos } = await conexion().query<Record<string, unknown>>(
    `SELECT requerido, estado, custodio, ubicacion_logica, vence_en, actualizado_en
       FROM documento_fisico WHERE documento_id = $1`,
    [documentoId],
  );

  return {
    documento,
    items: corrida ? await itemsDeCorrida(String(corrida['id'])) : [],
    hijos: await documentosHijos(inquilinoId, documentoId),
    archivo: archivos[0] ?? null,
    corrida,
    valores,
    candidatos,
    validacion: validaciones[0] ?? null,
    excepciones,
    revisiones,
    instantanea: instantaneas[0] ?? null,
    fisico: fisicos[0] ?? null,
  };
}

export async function bitacora(
  inquilinoId: string,
  documentoId: string,
  limite = 100,
): Promise<Record<string, unknown>[]> {
  const { rows } = await conexion().query<Record<string, unknown>>(
    `SELECT id, accion, tipo_actor, actor_id, origen, correlacion_id, antes, despues,
            metadatos, creado_en
       FROM evento_auditoria
      WHERE inquilino_id = $1 AND tipo_agregado = 'documento' AND agregado_id = $2
      ORDER BY id ASC
      LIMIT $3`,
    [inquilinoId, documentoId, limite],
  );
  return rows;
}

export interface FiltroExcepciones {
  estado?: string | undefined;
  severidad?: string | undefined;
  limite: number;
}

export async function colaDeExcepciones(
  inquilinoId: string,
  filtro: FiltroExcepciones,
): Promise<Record<string, unknown>[]> {
  const condiciones = ['e.inquilino_id = $1'];
  const parametros: unknown[] = [inquilinoId];

  parametros.push((filtro.estado ?? 'ABIERTA').toUpperCase());
  condiciones.push(`e.estado = $${parametros.length}`);

  if (filtro.severidad) {
    parametros.push(filtro.severidad);
    condiciones.push(`e.severidad = $${parametros.length}`);
  }

  parametros.push(filtro.limite);

  const { rows } = await conexion().query<Record<string, unknown>>(
    `SELECT e.id, e.documento_id, e.codigo_motivo, e.severidad, e.prioridad, e.motivos,
            e.accion_sugerida, e.estado, e.vence_en, e.creado_en,
            d.nombre_archivo, d.plantilla_codigo, d.estado AS estado_documento,
            (e.vence_en IS NOT NULL AND e.vence_en < now()) AS vencida
       FROM excepcion e
       JOIN documento d ON d.id = e.documento_id
      WHERE ${condiciones.join(' AND ')}
      ORDER BY (e.prioridad = 'ALTA') DESC, e.vence_en ASC NULLS LAST, e.creado_en ASC
      LIMIT $${parametros.length}`,
    parametros,
  );

  return rows;
}

export async function plantillasPublicadas(inquilinoId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await conexion().query<Record<string, unknown>>(
    `SELECT codigo, nombre, version, estado, umbral_auto_aprobacion, politica_fisica, definicion,
            publicado_en
       FROM plantilla_documental
      WHERE inquilino_id = $1 AND estado <> 'BORRADOR'
      ORDER BY codigo`,
    [inquilinoId],
  );
  return rows;
}

export async function eventosDeSalida(
  inquilinoId: string,
  estado: string,
  limite: number,
): Promise<Record<string, unknown>[]> {
  const { rows } = await conexion().query<Record<string, unknown>>(
    `SELECT id, tipo_agregado, agregado_id, tipo_evento, version_evento, correlacion_id,
            contenido, estado, intentos, proximo_intento_en, ultimo_error, creado_en, publicado_en
       FROM evento_salida
      WHERE inquilino_id = $1 AND estado = $2
      ORDER BY creado_en DESC
      LIMIT $3`,
    [inquilinoId, estado.toUpperCase(), limite],
  );
  return rows;
}

export interface FiltroVencimientos {
  familia?: string | undefined;
  plantilla?: string | undefined;
  situacion?: string | undefined;
  dias: number;
  limite: number;
}

export interface FilaVencimiento extends Record<string, unknown> {
  id: string;
  nombre_archivo: string;
  plantilla_codigo: string | null;
  familia: string | null;
  estado: string;
  vence_en: string;
  dias_restantes: number;
  situacion: string;
  sujeto_tipo: string | null;
  sujeto_id: string | null;
}

export async function vencimientos(
  inquilinoId: string,
  filtro: FiltroVencimientos,
): Promise<FilaVencimiento[]> {
  const condiciones = [
    'd.inquilino_id = $1',
    'd.vence_en IS NOT NULL',
    "d.estado NOT IN ('RECHAZADO', 'DIVIDIDO')",
  ];
  const parametros: unknown[] = [inquilinoId];

  if (filtro.familia) {
    parametros.push(filtro.familia.toUpperCase());
    condiciones.push(`d.familia = $${parametros.length}`);
  }

  if (filtro.plantilla) {
    parametros.push(filtro.plantilla.toUpperCase());
    condiciones.push(`d.plantilla_codigo = $${parametros.length}`);
  }

  parametros.push(filtro.dias);
  const ventana = `$${parametros.length}`;

  parametros.push(filtro.limite);

  const { rows } = await conexion().query<FilaVencimiento>(
    `SELECT d.id, d.nombre_archivo, d.plantilla_codigo, d.familia, d.estado,
            d.vence_en, d.sujeto_tipo, d.sujeto_id,
            (d.vence_en - CURRENT_DATE) AS dias_restantes,
            CASE
              WHEN d.vence_en < CURRENT_DATE THEN 'VENCIDO'
              WHEN d.vence_en <= CURRENT_DATE + ${ventana}::integer THEN 'POR_VENCER'
              ELSE 'VIGENTE'
            END AS situacion
       FROM documento d
      WHERE ${condiciones.join(' AND ')}
      ORDER BY d.vence_en ASC
      LIMIT $${parametros.length}`,
    parametros,
  );

  if (!filtro.situacion) return rows;
  const buscada = filtro.situacion.toUpperCase();
  return rows.filter((fila) => fila.situacion === buscada);
}

export async function resumenDeVencimientos(
  inquilinoId: string,
  dias: number,
): Promise<Record<string, number>> {
  const { rows } = await conexion().query<{ situacion: string; total: string }>(
    `SELECT CASE
              WHEN d.vence_en < CURRENT_DATE THEN 'VENCIDO'
              WHEN d.vence_en <= CURRENT_DATE + $2::integer THEN 'POR_VENCER'
              ELSE 'VIGENTE'
            END AS situacion,
            count(*) AS total
       FROM documento d
      WHERE d.inquilino_id = $1
        AND d.vence_en IS NOT NULL
        AND d.estado NOT IN ('RECHAZADO', 'DIVIDIDO')
      GROUP BY 1`,
    [inquilinoId, dias],
  );

  const base = { VENCIDO: 0, POR_VENCER: 0, VIGENTE: 0 };
  for (const fila of rows) base[fila.situacion as keyof typeof base] = Number(fila.total);
  return base;
}

export async function itemsDeCorrida(corridaId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await conexion().query<{ orden: number; contenido: Record<string, unknown> }>(
    'SELECT orden, contenido FROM item_extraido WHERE corrida_id = $1 ORDER BY orden',
    [corridaId],
  );
  return rows.map((r) => ({ orden: r.orden, ...r.contenido }));
}

export async function documentosHijos(
  inquilinoId: string,
  documentoId: string,
): Promise<Record<string, unknown>[]> {
  const { rows } = await conexion().query<Record<string, unknown>>(
    `SELECT id, nombre_archivo, estado, plantilla_codigo, confianza, pagina_desde, pagina_hasta
       FROM documento
      WHERE inquilino_id = $1 AND documento_padre_id = $2
      ORDER BY pagina_desde`,
    [inquilinoId, documentoId],
  );
  return rows;
}
