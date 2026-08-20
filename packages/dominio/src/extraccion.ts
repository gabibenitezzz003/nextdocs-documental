import type {
  CampoObservado,
  CampoPlantilla,
  Evidencia,
  Hallazgo,
  MapaValores,
  Plantilla,
  PresenciaCampo,
  Severidad,
  ValorExtraido,
} from './tipos.js';
import {
  comoDiaIso,
  fecha,
  normalizar,
  normalizarComprobante,
  normalizarCuit,
  normalizarPatente,
  numero,
  texto,
} from './valores.js';

export const CONFIANZA_SIN_EVIDENCIA = 0.7;
export const CONFIANZA_NO_NORMALIZABLE = 0.4;
export const CONFIANZA_FORMATO_INESPERADO = 0.5;

export function hallazgo(
  codigo: string,
  severidad: Severidad,
  mensaje: string,
  campos: string[] = [],
  origen: Hallazgo['origen'] = 'determinista',
): Hallazgo {
  return { codigo, severidad, mensaje, campos, origen };
}

export function normalizarValor(campo: CampoPlantilla, crudo: unknown): unknown {
  if (crudo === null || crudo === undefined || crudo === '') return null;
  switch (campo.tipo) {
    case 'cuit':
      return normalizarCuit(crudo);
    case 'patente':
      return normalizarPatente(crudo);
    case 'numero':
      return numero(crudo);
    case 'fecha':
      return comoDiaIso(fecha(crudo));
    case 'booleano': {
      if (typeof crudo === 'boolean') return crudo;
      const t = normalizar(crudo);
      if (['SI', 'TRUE', '1', 'CONFORME', 'CONFORMADO', 'OK'].includes(t)) return true;
      if (['NO', 'FALSE', '0', 'SIN CONFORMAR', 'DISCONFORME'].includes(t)) return false;
      return null;
    }
    case 'texto':
    default:
      if (campo.normalizar === 'comprobante') {
        return normalizarComprobante(crudo) ?? texto(crudo);
      }
      return texto(crudo) || null;
  }
}

function limpiarEvidencia(crudo: unknown): Evidencia | null {
  if (!crudo || typeof crudo !== 'object') return null;
  const e = crudo as Record<string, unknown>;
  const recorte = Array.isArray(e['recorte']) && e['recorte'].length === 4
    ? (e['recorte'].map((n) => Math.max(0, Math.min(1, Number(n) || 0))) as [number, number, number, number])
    : null;
  return {
    pagina: Number(e['pagina']) || 1,
    recorte,
    textoFuente: texto(e['textoFuente']).slice(0, 300) || null,
  };
}

export interface ResultadoProcesado {
  valores: MapaValores;
  hallazgos: Hallazgo[];
  confianza: number;
  observados: CampoObservado[];
}

export function presenciaDe(vinoAlgo: boolean, valorNormalizado: unknown): PresenciaCampo {
  if (!vinoAlgo) return 'NO_FIGURA';
  if (valorNormalizado === null || valorNormalizado === undefined) return 'ILEGIBLE';
  return 'PRESENTE';
}

export function procesarCampos(
  plantilla: Plantilla,
  camposBrutos: Record<string, unknown>,
): ResultadoProcesado {
  const valores: MapaValores = {};
  const hallazgos: Hallazgo[] = [];

  for (const campo of plantilla.campos) {
    const crudo = camposBrutos[campo.clave];
    const objeto = crudo && typeof crudo === 'object' ? (crudo as Record<string, unknown>) : null;
    const valorLeido = objeto ? objeto['valor'] : crudo;

    let confianza = objeto ? Number(objeto['confianza']) : 0;
    if (!Number.isFinite(confianza) || confianza < 0 || confianza > 1) confianza = 0;

    const valorNormalizado = normalizarValor(campo, valorLeido);
    const vinoAlgo = valorLeido !== null && valorLeido !== undefined && valorLeido !== '';

    if (vinoAlgo && valorNormalizado === null) {
      confianza = Math.min(confianza, CONFIANZA_NO_NORMALIZABLE);
      hallazgos.push(hallazgo(
        'VALOR_NO_NORMALIZABLE',
        'advertencia',
        `El valor leido para ${campo.clave} no tiene el formato esperado.`,
        [campo.clave],
        'sistema',
      ));
    }

    if (campo.patron && valorNormalizado !== null
      && !new RegExp(campo.patron).test(String(valorNormalizado))) {
      confianza = Math.min(confianza, CONFIANZA_FORMATO_INESPERADO);
      hallazgos.push(hallazgo(
        'FORMATO_INESPERADO',
        'advertencia',
        `El campo ${campo.clave} no respeta el formato ${campo.patron}.`,
        [campo.clave],
        'sistema',
      ));
    }

    const evidencia = limpiarEvidencia(objeto ? objeto['evidencia'] : null);
    if (valorNormalizado !== null && !evidencia) {
      confianza = Math.min(confianza, CONFIANZA_SIN_EVIDENCIA);
    }

    valores[campo.clave] = {
      valorLeido: valorLeido === undefined ? null : valorLeido,
      valorNormalizado,
      confianza: Math.round(confianza * 1000) / 1000,
      evidencia,
      critico: campo.critico,
      requerido: campo.requerido,
      presencia: presenciaDe(vinoAlgo, valorNormalizado),
    } satisfies ValorExtraido;
  }

  const observados = camposObservados(plantilla.campos, valores);

  for (const observado of observados) {
    hallazgos.push(hallazgo(
      observado.motivo === 'FALTANTE' ? 'CAMPO_REQUERIDO_FALTANTE' : 'CONFIANZA_INSUFICIENTE',
      observado.critico ? 'error' : 'advertencia',
      observado.motivo === 'FALTANTE'
        ? `Falta el campo requerido ${observado.clave}.`
        : `El campo ${observado.clave} quedo con confianza ${observado.confianza}.`,
      [observado.clave],
      'sistema',
    ));
  }

  return {
    valores,
    hallazgos,
    confianza: confianzaGlobal(plantilla.campos, valores),
    observados,
  };
}

export function confianzaGlobal(campos: CampoPlantilla[], valores: MapaValores): number {
  const criticos = campos.filter((c) => c.critico);
  const base = criticos.length ? criticos : campos;
  if (!base.length) return 0;
  const suma = base.reduce((acc, campo) => acc + (valores[campo.clave]?.confianza ?? 0), 0);
  return Math.round((suma / base.length) * 1000) / 1000;
}

export function camposObservados(campos: CampoPlantilla[], valores: MapaValores): CampoObservado[] {
  const observados: CampoObservado[] = [];
  for (const campo of campos) {
    const v = valores[campo.clave];
    const confianza = v?.confianza ?? 0;
    const vacio = !v || v.valorNormalizado === null || v.valorNormalizado === undefined;
    if (campo.requerido && vacio) {
      observados.push({ clave: campo.clave, motivo: 'FALTANTE', confianza, critico: campo.critico });
    } else if (!vacio && confianza < campo.umbral) {
      observados.push({
        clave: campo.clave, motivo: 'CONFIANZA_BAJA', confianza, critico: campo.critico,
      });
    }
  }
  return observados;
}

export function severidadMaxima(hallazgos: Hallazgo[]): Severidad | null {
  const orden: Record<Severidad, number> = { info: 0, advertencia: 1, error: 2, critico: 3 };
  let mayor: Severidad | null = null;
  for (const h of hallazgos) {
    if (mayor === null || orden[h.severidad] > orden[mayor]) mayor = h.severidad;
  }
  return mayor;
}
