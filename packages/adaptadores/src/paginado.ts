import { PDFDocument } from 'pdf-lib';

export const MAXIMO_SEGMENTOS = 60;

export class ErrorPaginado extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorPaginado';
    this.codigo = codigo;
  }
}

export function esPdf(tipoMime: string): boolean {
  return String(tipoMime ?? '').toLowerCase() === 'application/pdf';
}

export async function contarPaginas(contenido: Buffer): Promise<number> {
  try {
    const documento = await PDFDocument.load(contenido, { ignoreEncryption: true });
    return documento.getPageCount();
  } catch (error) {
    throw new ErrorPaginado('PDF_ILEGIBLE', (error as Error).message);
  }
}

export async function extraerPaginas(
  contenido: Buffer,
  desde: number,
  hasta: number,
): Promise<Buffer> {
  let original: PDFDocument;
  try {
    original = await PDFDocument.load(contenido, { ignoreEncryption: true });
  } catch (error) {
    throw new ErrorPaginado('PDF_ILEGIBLE', (error as Error).message);
  }

  const total = original.getPageCount();
  const primera = Math.max(1, Math.min(desde, total));
  const ultima = Math.max(primera, Math.min(hasta, total));

  const recorte = await PDFDocument.create();
  const indices = [];
  for (let i = primera - 1; i <= ultima - 1; i += 1) indices.push(i);

  const paginas = await recorte.copyPages(original, indices);
  for (const pagina of paginas) recorte.addPage(pagina);

  return Buffer.from(await recorte.save());
}

export interface Segmento {
  desde: number;
  hasta: number;
  tipo: string | null;
}

export function segmentosPorPagina(totalPaginas: number): Segmento[] {
  const segmentos: Segmento[] = [];
  for (let pagina = 1; pagina <= Math.min(totalPaginas, MAXIMO_SEGMENTOS); pagina += 1) {
    segmentos.push({ desde: pagina, hasta: pagina, tipo: null });
  }
  return segmentos;
}

export function normalizarSegmentos(crudos: unknown, totalPaginas: number): Segmento[] {
  if (!Array.isArray(crudos)) return [];

  const limpios: Segmento[] = [];
  let ultimaPagina = 0;

  for (const crudo of crudos) {
    if (!crudo || typeof crudo !== 'object') continue;
    const item = crudo as Record<string, unknown>;

    const desde = Number(item['desde'] ?? item['paginaDesde']);
    const hasta = Number(item['hasta'] ?? item['paginaHasta'] ?? desde);

    if (!Number.isInteger(desde) || !Number.isInteger(hasta)) continue;
    if (desde < 1 || hasta > totalPaginas || hasta < desde) continue;
    if (desde <= ultimaPagina) continue;

    limpios.push({
      desde,
      hasta,
      tipo: item['tipo'] ? String(item['tipo']).toUpperCase() : null,
    });

    ultimaPagina = hasta;
    if (limpios.length >= MAXIMO_SEGMENTOS) break;
  }

  if (!limpios.length) return [];

  const cubiertas = limpios.reduce((suma, s) => suma + (s.hasta - s.desde + 1), 0);
  if (cubiertas !== totalPaginas) return [];

  return limpios;
}
