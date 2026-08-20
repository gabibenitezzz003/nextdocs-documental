import type {
  CampoObservado,
  Decision,
  EstadoDocumento,
  Hallazgo,
  MotivoDecision,
  Plantilla,
  ResultadoEmparejamiento,
  Severidad,
} from './tipos.js';

export const TRANSICIONES: Record<EstadoDocumento, EstadoDocumento[]> = {
  RECIBIDO: ['PROCESANDO', 'RECHAZADO'],
  PROCESANDO: ['EXTRAIDO', 'OBSERVADO', 'RECHAZADO', 'DIVIDIDO'],
  EXTRAIDO: ['VALIDADO', 'OBSERVADO'],
  VALIDADO: ['APROBADO', 'OBSERVADO', 'RECHAZADO'],
  OBSERVADO: ['PROCESANDO', 'VALIDADO', 'APROBADO', 'RECHAZADO'],
  APROBADO: ['CERRADO'],
  RECHAZADO: [],
  CERRADO: [],
  DIVIDIDO: [],
};

export function transicionValida(desde: EstadoDocumento | null, hasta: EstadoDocumento): boolean {
  if (desde === null) return hasta === 'RECIBIDO';
  return TRANSICIONES[desde].includes(hasta);
}

export class TransicionInvalida extends Error {
  readonly codigo = 'TRANSICION_INVALIDA';

  constructor(readonly desde: EstadoDocumento | null, readonly hasta: EstadoDocumento) {
    super(`No se puede pasar de ${desde ?? 'inexistente'} a ${hasta}.`);
    this.name = 'TransicionInvalida';
  }
}

export function exigirTransicion(desde: EstadoDocumento | null, hasta: EstadoDocumento): void {
  if (!transicionValida(desde, hasta)) throw new TransicionInvalida(desde, hasta);
}

const ACCIONES: Record<string, string> = {
  CONFIANZA_GLOBAL_BAJA: 'Revisar los campos marcados y corregir lo que este mal leido.',
  CAMPOS_CRITICOS_OBSERVADOS: 'Completar o corregir los campos criticos senalados.',
  REGLAS_CON_ERROR: 'Revisar los hallazgos de validacion antes de aprobar.',
  EMPAREJAMIENTO_NO_RESUELTO: 'Elegir a mano el objeto de negocio correcto entre los candidatos.',
};

export function accionSugerida(codigo: string): string {
  return ACCIONES[codigo] ?? 'Revisar el documento en el centro de excepciones.';
}

export interface EntradaDecision {
  plantilla: Plantilla;
  confianza: number;
  observados: CampoObservado[];
  hallazgos: Hallazgo[];
  emparejamiento: ResultadoEmparejamiento;
}

export function decidir(entrada: EntradaDecision): Decision {
  const { plantilla, confianza, observados, hallazgos, emparejamiento } = entrada;
  const motivos: MotivoDecision[] = [];

  if (confianza < plantilla.umbralAutoAprobacion) {
    motivos.push({
      codigo: 'CONFIANZA_GLOBAL_BAJA',
      severidad: 'advertencia',
      detalle: `La confianza fue ${confianza} y el umbral es ${plantilla.umbralAutoAprobacion}.`,
    });
  }

  const criticos = observados.filter((c) => c.critico);
  if (criticos.length) {
    motivos.push({
      codigo: 'CAMPOS_CRITICOS_OBSERVADOS',
      severidad: 'error',
      detalle: `Campos criticos con problema: ${criticos.map((c) => c.clave).join(', ')}.`,
    });
  }

  const errores = hallazgos.filter((h) => h.severidad === 'error' || h.severidad === 'critico');
  if (errores.length) {
    motivos.push({
      codigo: 'REGLAS_CON_ERROR',
      severidad: 'error',
      detalle: errores.map((e) => e.codigo).join(', '),
    });
  }

  const resuelto = emparejamiento.resolucion === 'CONFIRMADO_AUTOMATICO'
    || emparejamiento.resolucion === 'CONFIRMADO_MANUAL';

  if (!resuelto) {
    motivos.push({
      codigo: 'EMPAREJAMIENTO_NO_RESUELTO',
      severidad: emparejamiento.resolucion === 'AMBIGUO' ? 'error' : 'advertencia',
      detalle: `Estado del emparejamiento: ${emparejamiento.resolucion}.`,
    });
  }

  const aprobable = motivos.length === 0;

  return {
    aprobable,
    estado: aprobable ? 'APROBADO' : 'OBSERVADO',
    motivos,
    confianza,
    umbral: plantilla.umbralAutoAprobacion,
  };
}

export function severidadDeExcepcion(motivos: MotivoDecision[]): Severidad {
  return motivos.some((m) => m.severidad === 'error' || m.severidad === 'critico')
    ? 'error'
    : 'advertencia';
}

export function horasDeSla(severidad: Severidad): number {
  return severidad === 'error' || severidad === 'critico' ? 4 : 24;
}
