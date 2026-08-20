import type {
  EntradaClasificacion,
  EntradaExtraccion,
  EntradaSegmentacion,
  MotorDocumental,
  SalidaClasificacion,
  SalidaExtraccion,
  SalidaSegmentacion,
} from './inteligencia.js';
import {
  ErrorMotorDocumental,
  leerJson,
  promptDeClasificacion,
  promptDeExtraccion,
  promptDeSegmentacion,
} from './inteligencia.js';
import { normalizarSegmentos } from './paginado.js';

const RAIZ = 'https://generativelanguage.googleapis.com/v1beta/models';

function codigoDeEstado(estado: number): string {
  if (estado === 429) return 'PROVEEDOR_SATURADO';
  if (estado >= 500) return 'PROVEEDOR_NO_DISPONIBLE';
  return 'PROVEEDOR_CON_ERROR';
}

interface RespuestaGemini {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

export class MotorGemini implements MotorDocumental {
  private readonly clave: string;

  private readonly modelo: string;

  constructor(configuracion?: { clave?: string; modelo?: string }) {
    const clave = configuracion?.clave ?? process.env['GOOGLE_API_KEY'];
    if (!clave) throw new Error('Falta GOOGLE_API_KEY para usar el motor Gemini.');
    this.clave = clave;
    this.modelo = configuracion?.modelo ?? process.env['GEMINI_MODELO'] ?? 'gemini-2.0-flash';
  }

  private async invocar(instruccion: string, contenido: Buffer, tipoMime: string): Promise<{
    texto: string;
    entradas: number;
    salidas: number;
  }> {
    const cuerpo = {
      contents: [{
        parts: [
          { text: instruccion },
          { inline_data: { mime_type: tipoMime, data: contenido.toString('base64') } },
        ],
      }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    };

    let respuesta: Response;
    try {
      respuesta = await fetch(`${RAIZ}/${this.modelo}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.clave },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new ErrorMotorDocumental('PROVEEDOR_INALCANZABLE', (error as Error).message);
    }

    if (!respuesta.ok) {
      const detalle = await respuesta.text();
      throw new ErrorMotorDocumental(
        codigoDeEstado(respuesta.status),
        `${respuesta.status}: ${detalle.slice(0, 300)}`,
      );
    }

    const datos = (await respuesta.json()) as RespuestaGemini;
    if (datos.error) {
      throw new ErrorMotorDocumental('PROVEEDOR_CON_ERROR', datos.error.message ?? 'error sin detalle');
    }

    const texto = datos.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return {
      texto,
      entradas: datos.usageMetadata?.promptTokenCount ?? 0,
      salidas: datos.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  async clasificar(entrada: EntradaClasificacion): Promise<SalidaClasificacion> {
    const instruccion = promptDeClasificacion(entrada.plantillasPosibles, entrada.nombreArchivo);
    const { texto } = await this.invocar(instruccion, entrada.contenido, entrada.tipoMime);
    const leido = leerJson(texto);

    if (!leido) {
      throw new ErrorMotorDocumental('SALIDA_NO_PARSEABLE', 'La clasificacion no vino como JSON.');
    }

    const confianza = Number(leido['confianza']);

    return {
      tipo: String(leido['tipo'] ?? 'DESCONOCIDO').toUpperCase(),
      confianza: Number.isFinite(confianza) ? Math.max(0, Math.min(1, confianza)) : 0,
      motivo: leido['motivo'] ? String(leido['motivo']).slice(0, 300) : null,
    };
  }

  async segmentar(entrada: EntradaSegmentacion): Promise<SalidaSegmentacion> {
    const instruccion = promptDeSegmentacion(entrada.plantillasPosibles, entrada.totalPaginas);
    const { texto } = await this.invocar(instruccion, entrada.contenido, entrada.tipoMime);
    const leido = leerJson(texto);

    if (!leido) {
      throw new ErrorMotorDocumental('SALIDA_NO_PARSEABLE', 'La segmentacion no vino como JSON.');
    }

    return { segmentos: normalizarSegmentos(leido['segmentos'], entrada.totalPaginas) };
  }

  async extraer(entrada: EntradaExtraccion): Promise<SalidaExtraccion> {
    const instruccion = promptDeExtraccion(entrada.plantilla, entrada.pistas ?? []);
    const { texto, entradas, salidas } = await this.invocar(
      instruccion,
      entrada.contenido,
      entrada.tipoMime,
    );
    const leido = leerJson(texto);

    if (!leido) {
      throw new ErrorMotorDocumental('SALIDA_NO_PARSEABLE', 'La extraccion no vino como JSON.');
    }

    const campos = leido['campos'];
    const items = leido['items'];
    const observaciones = leido['observaciones'];

    return {
      campos: campos && typeof campos === 'object' ? campos as Record<string, unknown> : {},
      items: Array.isArray(items) ? items.slice(0, 200) as Record<string, unknown>[] : [],
      observaciones: Array.isArray(observaciones)
        ? observaciones.map((o) => String(o)).filter(Boolean).slice(0, 20)
        : [],
      uso: { proveedor: 'google', modelo: this.modelo, entradas, salidas },
    };
  }
}
