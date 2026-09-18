export type TipoDato = 'texto' | 'numero' | 'fecha' | 'cuit' | 'patente' | 'booleano' | 'documento';

export type FamiliaDocumento =
  | 'FISCAL'
  | 'LOGISTICO'
  | 'IDENTIDAD'
  | 'VEHICULAR'
  | 'HABILITANTE'
  | 'COMERCIAL';

export type Severidad = 'info' | 'advertencia' | 'error' | 'critico';

export type EstadoDocumento =
  | 'RECIBIDO'
  | 'PROCESANDO'
  | 'EXTRAIDO'
  | 'VALIDADO'
  | 'OBSERVADO'
  | 'APROBADO'
  | 'RECHAZADO'
  | 'CERRADO'
  | 'DIVIDIDO'
  | 'ELIMINADO';

export type EstadoFisico =
  | 'NO_REQUERIDO'
  | 'REQUERIDO'
  | 'EN_CUSTODIA'
  | 'EN_TRANSITO'
  | 'RECIBIDO'
  | 'VENCIDO'
  | 'PERDIDO'
  | 'CERRADO';

export type ResolucionEmparejamiento =
  | 'SIN_CANDIDATOS'
  | 'DEBIL'
  | 'AMBIGUO'
  | 'CONFIRMADO_AUTOMATICO'
  | 'CONFIRMADO_MANUAL';

export interface CampoPlantilla {
  clave: string;
  tipo: TipoDato;
  requerido: boolean;
  critico: boolean;
  umbral: number;
  patron?: string;
  normalizar?: 'comprobante';
}

export interface ClaveEmparejamiento {
  objeto: string;
  campo: string;
  metodo: 'EXACTO' | 'NORMALIZADO' | 'COMPROBANTE';
  peso: number;
}

export interface ReglaPlantilla {
  codigo: string;
  tipo: 'INTRINSECA' | 'MAESTROS' | 'TEMPORAL' | 'CRUZADA' | 'OPERATIVA' | 'SEMANTICA';
  severidad: Severidad;
  mensaje: string;
}

export interface Plantilla {
  codigo: string;
  version: number;
  nombre: string;
  familia: FamiliaDocumento;
  claveVencimiento?: string;
  diasAvisoVencimiento?: number;
  umbralAutoAprobacion: number;
  politicaFisica: 'NO_REQUERIDO' | 'REQUERIDO';
  campos: CampoPlantilla[];
  tabla?: { clave: string; columnas: string[] };
  clavesEmparejamiento: ClaveEmparejamiento[];
  reglas: ReglaPlantilla[];
  validacionFiscal?: boolean;
}

export interface Evidencia {
  pagina: number;
  recorte: [number, number, number, number] | null;
  textoFuente: string | null;
}

export type PresenciaCampo = 'PRESENTE' | 'NO_FIGURA' | 'ILEGIBLE';

export interface ValorExtraido {
  valorLeido: unknown;
  valorNormalizado: unknown;
  confianza: number;
  evidencia: Evidencia | null;
  critico: boolean;
  requerido: boolean;
  presencia: PresenciaCampo;
}

export type MapaValores = Record<string, ValorExtraido>;

export interface Hallazgo {
  codigo: string;
  severidad: Severidad;
  mensaje: string;
  campos: string[];
  origen: 'determinista' | 'semantica' | 'sistema';
}

export interface CampoObservado {
  clave: string;
  motivo: 'FALTANTE' | 'CONFIANZA_BAJA';
  confianza: number;
  critico: boolean;
}

export interface ObjetoNegocio {
  tipo: string;
  id: string;
  etiqueta?: string;
  [clave: string]: unknown;
}

export interface Candidato {
  tipoObjeto: string;
  objetoId: string | null;
  etiqueta: string;
  puntaje: number;
  metodo: string;
  razones: string[];
}

export interface ResultadoEmparejamiento {
  resolucion: ResolucionEmparejamiento;
  sujeto: { tipo: string; id: string | null; etiqueta: string } | null;
  candidatos: Candidato[];
  hallazgos: Hallazgo[];
}

export interface MotivoDecision {
  codigo: string;
  severidad: Severidad;
  detalle: string;
}

export interface Decision {
  aprobable: boolean;
  estado: EstadoDocumento;
  motivos: MotivoDecision[];
  confianza: number;
  umbral: number;
}
