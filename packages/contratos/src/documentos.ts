import { z } from 'zod';

export const TIPOS_ACEPTADOS: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/tiff': ['tif', 'tiff'],
};

export const LIMITES = {
  tamanoMaximoBytes: 25 * 1024 * 1024,
  paginasMaximas: 40,
  nombreMaximo: 180,
} as const;

export const esquemaCargarDocumento = z.object({
  origen: z.enum(['API', 'WEB', 'EMAIL', 'SFTP', 'WHATSAPP', 'CONECTOR']).default('API'),
  nombreArchivo: z.string().min(1).max(LIMITES.nombreMaximo),
  tipoMime: z.string().min(3).optional(),
  contenidoBase64: z.string().min(16),
  referenciaExterna: z.string().max(120).nullish(),
  plantilla: z.string().max(40).nullish(),
});

export type CargarDocumento = z.infer<typeof esquemaCargarDocumento>;

export const esquemaRevision = z.object({
  claveCampo: z.string().max(80).nullish(),
  decision: z.enum(['CORREGIR', 'APROBAR', 'RECHAZAR']),
  motivo: z.string().max(500).nullish(),
  valor: z.unknown().optional(),
});

export type Revision = z.infer<typeof esquemaRevision>;

export const esquemaConfirmarEmparejamiento = z.object({
  candidatoId: z.string().uuid(),
  motivo: z.string().max(500).nullish(),
});

export const esquemaResolverExcepcion = z.object({
  resolucion: z.string().min(3).max(500),
  decision: z.enum(['RESUELTA', 'DESCARTADA', 'ESCALADA']),
});

export const esquemaListado = z.object({
  estado: z.string().max(30).optional(),
  plantilla: z.string().max(40).optional(),
  cursor: z.string().max(120).optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
});

export type Listado = z.infer<typeof esquemaListado>;

export interface RespuestaCarga {
  aceptado: boolean;
  documentoId: string | null;
  estado: string | null;
  motivo?: string;
  rechazos?: { codigo: string; mensaje: string }[];
  duplicadoDe?: string;
}

export interface ProblemaHttp {
  tipo: string;
  titulo: string;
  estado: number;
  detalle: string;
  codigo: string;
  instancia?: string;
  correlacionId?: string;
}

export const CODIGOS_ERROR = {
  DOCUMENTO_NO_ENCONTRADO: 'DOCUMENTO_NO_ENCONTRADO',
  ACCESO_DENEGADO_INQUILINO: 'ACCESO_DENEGADO_INQUILINO',
  TRANSICION_INVALIDA: 'TRANSICION_INVALIDA',
  PLANTILLA_NO_PUBLICADA: 'PLANTILLA_NO_PUBLICADA',
  REVISION_REQUERIDA: 'REVISION_REQUERIDA',
  EMPAREJAMIENTO_AMBIGUO: 'EMPAREJAMIENTO_AMBIGUO',
  VALIDACION_FALLIDA: 'VALIDACION_FALLIDA',
  CONFLICTO_CONCURRENCIA: 'CONFLICTO_CONCURRENCIA',
  ARCHIVO_RECHAZADO: 'ARCHIVO_RECHAZADO',
  INTEGRACION_NO_DISPONIBLE: 'INTEGRACION_NO_DISPONIBLE',
} as const;

export type CodigoError = (typeof CODIGOS_ERROR)[keyof typeof CODIGOS_ERROR];
