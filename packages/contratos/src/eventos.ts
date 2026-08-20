export const TIPOS_EVENTO = [
  'documento.recibido',
  'documento.dividido',
  'documento.clasificado',
  'documento.extraido',
  'documento.emparejado',
  'documento.validado',
  'documento.observado',
  'documento.aprobado',
  'documento.rechazado',
  'documento.cerrado',
  'fisico.estado_cambiado',
  'revision.completada',
  'integracion.entrega_fallida',
] as const;

export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export interface SobreEvento<T = Record<string, unknown>> {
  eventoId: string;
  tipoEvento: TipoEvento;
  versionEvento: number;
  ocurridoEn: string;
  inquilinoId: string;
  tipoAgregado: string;
  agregadoId: string;
  correlacionId: string | null;
  causacionId: string | null;
  datos: T;
}

export interface DatosRecibido {
  origen: string;
  referenciaExterna: string | null;
  huella: string;
  nombreArchivo: string;
}

export interface DatosExtraido {
  plantilla: string;
  plantillaVersion: number;
  corridaId: string;
  confianza: number;
  camposObservados: number;
}

export interface DatosEmparejado {
  resolucion: string;
  tipoObjeto: string | null;
  objetoId: string | null;
  puntaje: number | null;
}

export interface DatosValidado {
  corridaId: string;
  resultado: string;
  hallazgosCriticos: number;
}

export interface DatosObservado {
  codigoMotivo: string;
  severidad: string;
  excepcionId: string;
}

export interface DatosAprobado {
  aprobadoPor: string;
  instantaneaId: string;
  sello: string;
}

export const NOMBRE_COLA_PROCESAMIENTO = 'docvance-procesamiento';
export const NOMBRE_COLA_ENTREGA = 'docvance-entrega';

export interface TareaProcesamiento {
  documentoId: string;
  inquilinoId: string;
  correlacionId: string;
  intento: number;
}

export interface TareaEntrega {
  eventoSalidaId: string;
  inquilinoId: string;
}
