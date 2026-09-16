import { createHash, randomUUID } from 'node:crypto';

import {
  contarPaginas,
  esPdf,
  extraerPaginas,
  segmentosPorPagina,
  type Almacenamiento,
  type MotorDocumental,
  type Segmento,
} from '@nextdocs/adaptadores';
import { NOMBRE_COLA_PROCESAMIENTO, claveAlmacen } from '@nextdocs/contratos';
import { enTransaccion } from '@nextdocs/db';

import { SISTEMA, auditar, encolarEvento, type Actor } from './auditoria.js';

export interface DocumentoADividir {
  id: string;
  inquilino_id: string;
  tipo_mime: string;
  nombre_archivo: string;
  clave_almacen: string;
  documento_padre_id?: string | null;
}

export interface ResultadoSegmentacion {
  dividido: boolean;
  totalPaginas: number;
  hijos: { documentoId: string; desde: number; hasta: number; tipo: string | null }[];
}

const SIN_DIVIDIR: ResultadoSegmentacion = { dividido: false, totalPaginas: 1, hijos: [] };

export function nombreDeSegmento(nombre: string, segmento: Segmento): string {
  const base = nombre.replace(/\.pdf$/i, '');
  const rango = segmento.desde === segmento.hasta
    ? `p${segmento.desde}`
    : `p${segmento.desde}-${segmento.hasta}`;
  return `${base}_${rango}.pdf`;
}

async function decidirSegmentos(
  motor: MotorDocumental,
  contenido: Buffer,
  tipoMime: string,
  totalPaginas: number,
  plantillasPosibles: string[],
): Promise<Segmento[]> {
  if (!motor.segmentar) return segmentosPorPagina(totalPaginas);

  try {
    const salida = await motor.segmentar({
      contenido,
      tipoMime,
      totalPaginas,
      plantillasPosibles,
    });
    if (salida.segmentos.length) return salida.segmentos;
  } catch {
    return segmentosPorPagina(totalPaginas);
  }

  return segmentosPorPagina(totalPaginas);
}

export async function dividirSiHaceFalta(
  documento: DocumentoADividir,
  contenido: Buffer,
  correlacionId: string,
  dependencias: {
    almacenamiento: Almacenamiento;
    motor: MotorDocumental;
    encolar: (nombre: string, clave: string, datos: Record<string, unknown>) => Promise<void>;
  },
  plantillasPosibles: string[],
  actor: Actor = SISTEMA,
): Promise<ResultadoSegmentacion> {
  if (documento.documento_padre_id) return SIN_DIVIDIR;
  if (!esPdf(documento.tipo_mime)) return SIN_DIVIDIR;

  let totalPaginas: number;
  try {
    totalPaginas = await contarPaginas(contenido);
  } catch {
    return SIN_DIVIDIR;
  }

  if (totalPaginas <= 1) return { ...SIN_DIVIDIR, totalPaginas };

  const segmentos = await decidirSegmentos(
    dependencias.motor,
    contenido,
    documento.tipo_mime,
    totalPaginas,
    plantillasPosibles,
  );

  if (segmentos.length <= 1) return { dividido: false, totalPaginas, hijos: [] };

  const hijos: ResultadoSegmentacion['hijos'] = [];

  for (const segmento of segmentos) {
    const recorte = await extraerPaginas(contenido, segmento.desde, segmento.hasta);
    const hijoId = randomUUID();
    const huella = createHash('sha256').update(recorte).digest('hex');
    const clave = claveAlmacen(documento.inquilino_id, hijoId, 'application/pdf');

    await dependencias.almacenamiento.guardar(clave, recorte, 'application/pdf');

    await enTransaccion(async (cliente) => {
      await cliente.query(
        `INSERT INTO documento
           (id, inquilino_id, origen, huella, tipo_mime, nombre_archivo, estado,
            plantilla_codigo, documento_padre_id, pagina_desde, pagina_hasta)
         VALUES ($1, $2, 'SEGMENTO', $3, 'application/pdf', $4, 'RECIBIDO', $5, $6, $7, $8)`,
        [
          hijoId,
          documento.inquilino_id,
          huella,
          nombreDeSegmento(documento.nombre_archivo, segmento),
          segmento.tipo,
          documento.id,
          segmento.desde,
          segmento.hasta,
        ],
      );

      await cliente.query(
        `INSERT INTO archivo_documento
           (inquilino_id, documento_id, clave_almacen, version, suma, tamano_bytes, paginas)
         VALUES ($1, $2, $3, 1, $4, $5, $6)`,
        [
          documento.inquilino_id,
          hijoId,
          clave,
          huella,
          recorte.length,
          segmento.hasta - segmento.desde + 1,
        ],
      );

      await auditar(cliente, {
        inquilinoId: documento.inquilino_id,
        tipoAgregado: 'documento',
        agregadoId: hijoId,
        accion: 'RECIBIDO',
        actor,
        origen: 'SEGMENTO',
        correlacionId,
        despues: {
          documentoPadreId: documento.id,
          paginaDesde: segmento.desde,
          paginaHasta: segmento.hasta,
          tipoPropuesto: segmento.tipo,
        },
      });
    });

    await dependencias.encolar(NOMBRE_COLA_PROCESAMIENTO, hijoId, {
      documentoId: hijoId,
      inquilinoId: documento.inquilino_id,
      correlacionId,
      intento: 1,
    });

    hijos.push({
      documentoId: hijoId,
      desde: segmento.desde,
      hasta: segmento.hasta,
      tipo: segmento.tipo,
    });
  }

  await enTransaccion(async (cliente) => {
    await cliente.query(
      'UPDATE documento SET estado = $1, actualizado_en = now() WHERE id = $2',
      ['DIVIDIDO', documento.id],
    );

    await auditar(cliente, {
      inquilinoId: documento.inquilino_id,
      tipoAgregado: 'documento',
      agregadoId: documento.id,
      accion: 'ESTADO_DIVIDIDO',
      actor,
      origen: 'PIPELINE',
      correlacionId,
      antes: { estado: 'PROCESANDO' },
      despues: { estado: 'DIVIDIDO', documentos: hijos.length, paginas: totalPaginas },
    });

    await encolarEvento(cliente, {
      inquilinoId: documento.inquilino_id,
      tipoAgregado: 'documento',
      agregadoId: documento.id,
      tipoEvento: 'documento.dividido',
      correlacionId,
      datos: { totalPaginas, documentos: hijos },
    });
  });

  return { dividido: true, totalPaginas, hijos };
}
