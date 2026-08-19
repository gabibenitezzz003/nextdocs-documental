import type {
  Candidato,
  MapaValores,
  ObjetoNegocio,
  Plantilla,
  ResultadoEmparejamiento,
} from './tipos.js';
import { hallazgo } from './extraccion.js';
import { claveComparacion, normalizar, normalizarComprobante, texto } from './valores.js';

export const UMBRAL_CONFIABLE = 70;
export const MARGEN_AMBIGUEDAD = 15;

function coincide(metodo: string, valorDocumento: unknown, valorObjeto: unknown): boolean {
  if (valorDocumento === null || valorDocumento === undefined) return false;
  if (valorObjeto === null || valorObjeto === undefined) return false;

  if (metodo === 'EXACTO') {
    return claveComparacion(valorDocumento) === claveComparacion(valorObjeto);
  }
  if (metodo === 'NORMALIZADO') {
    const a = claveComparacion(valorDocumento);
    const b = claveComparacion(valorObjeto);
    if (!a || !b) return false;
    return a === b || a.startsWith(b) || b.startsWith(a);
  }
  if (metodo === 'COMPROBANTE') {
    const a = normalizarComprobante(valorDocumento);
    const b = normalizarComprobante(valorObjeto);
    return a !== null && a === b;
  }
  return false;
}

export function emparejar(
  plantilla: Plantilla,
  valores: MapaValores,
  catalogo: ObjetoNegocio[],
): ResultadoEmparejamiento {
  const candidatos: Candidato[] = [];

  for (const objeto of catalogo) {
    const tipoObjeto = normalizar(objeto.tipo);
    let puntaje = 0;
    const razones: string[] = [];

    for (const regla of plantilla.clavesEmparejamiento) {
      if (regla.objeto !== tipoObjeto) continue;
      const valorDocumento = valores[regla.campo]?.valorNormalizado ?? null;
      const valorObjeto = objeto[regla.campo] ?? null;
      if (coincide(regla.metodo, valorDocumento, valorObjeto)) {
        puntaje += regla.peso;
        razones.push(`${regla.campo} coincide por ${regla.metodo}`);
      }
    }

    if (puntaje > 0) {
      candidatos.push({
        tipoObjeto,
        objetoId: objeto.id ?? null,
        etiqueta: texto(objeto.etiqueta ?? objeto.id),
        puntaje,
        metodo: razones.length > 1 ? 'COMBINADO' : (razones[0] ?? 'SIN_METODO'),
        razones,
      });
    }
  }

  candidatos.sort((a, b) => b.puntaje - a.puntaje);

  const mejor = candidatos[0];
  const segundo = candidatos[1];

  if (!mejor) {
    return {
      resolucion: 'SIN_CANDIDATOS',
      sujeto: null,
      candidatos: [],
      hallazgos: [hallazgo(
        'SIN_EMPAREJAMIENTO',
        'advertencia',
        'No se encontro ningun objeto de negocio asociable al documento.',
        [],
        'sistema',
      )],
    };
  }

  const ambiguo = segundo !== undefined && (mejor.puntaje - segundo.puntaje) < MARGEN_AMBIGUEDAD;

  if (ambiguo) {
    return {
      resolucion: 'AMBIGUO',
      sujeto: null,
      candidatos: candidatos.slice(0, 10),
      hallazgos: [hallazgo(
        'EMPAREJAMIENTO_AMBIGUO',
        'error',
        `Hay ${candidatos.length} objetos plausibles con puntajes similares. Requiere confirmacion humana.`,
        [],
        'sistema',
      )],
    };
  }

  if (mejor.puntaje < UMBRAL_CONFIABLE) {
    return {
      resolucion: 'DEBIL',
      sujeto: null,
      candidatos: candidatos.slice(0, 10),
      hallazgos: [hallazgo(
        'EMPAREJAMIENTO_DEBIL',
        'advertencia',
        `El mejor candidato alcanzo ${mejor.puntaje} puntos, por debajo de ${UMBRAL_CONFIABLE}.`,
        [],
        'sistema',
      )],
    };
  }

  return {
    resolucion: 'CONFIRMADO_AUTOMATICO',
    sujeto: { tipo: mejor.tipoObjeto, id: mejor.objetoId, etiqueta: mejor.etiqueta },
    candidatos: candidatos.slice(0, 10),
    hallazgos: [],
  };
}
