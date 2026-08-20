import type { Plantilla, ReglaPlantilla } from './tipos.js';

const VIGENCIA: ReglaPlantilla[] = [
  { codigo: 'VENCIDO', tipo: 'TEMPORAL', severidad: 'critico', mensaje: 'El documento esta vencido.' },
  { codigo: 'POR_VENCER', tipo: 'TEMPORAL', severidad: 'advertencia', mensaje: 'El documento vence pronto.' },
  { codigo: 'SIN_VENCIMIENTO', tipo: 'INTRINSECA', severidad: 'error', mensaje: 'No se pudo leer la fecha de vencimiento.' },
];

const PATENTE: ReglaPlantilla = {
  codigo: 'PATENTE_INVALIDA',
  tipo: 'INTRINSECA',
  severidad: 'error',
  mensaje: 'La patente no tiene un formato argentino valido.',
};

const CUIT: ReglaPlantilla = {
  codigo: 'CUIT_INVALIDO',
  tipo: 'INTRINSECA',
  severidad: 'error',
  mensaje: 'El CUIT no supera la validacion de digito verificador.',
};

const FECHA_FUTURA: ReglaPlantilla = {
  codigo: 'FECHA_FUTURA',
  tipo: 'TEMPORAL',
  severidad: 'error',
  mensaje: 'La fecha de emision es posterior a hoy.',
};

export const DNI: Plantilla = {
  codigo: 'DNI',
  version: 1,
  nombre: 'Documento nacional de identidad',
  familia: 'IDENTIDAD',
  claveVencimiento: 'fechaVencimiento',
  diasAvisoVencimiento: 60,
  umbralAutoAprobacion: 0.93,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'numeroDocumento', tipo: 'documento', requerido: true, critico: true, umbral: 0.95 },
    { clave: 'apellido', tipo: 'texto', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'nombre', tipo: 'texto', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'sexo', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'fechaNacimiento', tipo: 'fecha', requerido: false, critico: false, umbral: 0.9 },
    { clave: 'fechaEmision', tipo: 'fecha', requerido: false, critico: false, umbral: 0.88 },
    { clave: 'fechaVencimiento', tipo: 'fecha', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'numeroTramite', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'cuil', tipo: 'cuit', requerido: false, critico: false, umbral: 0.9 },
  ],
  clavesEmparejamiento: [
    { objeto: 'CHOFER', campo: 'numeroDocumento', metodo: 'EXACTO', peso: 80 },
    { objeto: 'CHOFER', campo: 'cuil', metodo: 'EXACTO', peso: 60 },
  ],
  reglas: [...VIGENCIA, CUIT],
};

export const LICENCIA_CONDUCIR: Plantilla = {
  codigo: 'LICENCIA_CONDUCIR',
  version: 1,
  nombre: 'Licencia nacional de conducir',
  familia: 'IDENTIDAD',
  claveVencimiento: 'fechaVencimiento',
  diasAvisoVencimiento: 45,
  umbralAutoAprobacion: 0.93,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'numeroDocumento', tipo: 'documento', requerido: true, critico: true, umbral: 0.95 },
    { clave: 'apellido', tipo: 'texto', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'nombre', tipo: 'texto', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'clases', tipo: 'texto', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'fechaOtorgamiento', tipo: 'fecha', requerido: false, critico: false, umbral: 0.88 },
    { clave: 'fechaVencimiento', tipo: 'fecha', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'restricciones', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'jurisdiccion', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
  ],
  clavesEmparejamiento: [
    { objeto: 'CHOFER', campo: 'numeroDocumento', metodo: 'EXACTO', peso: 80 },
    { objeto: 'CHOFER', campo: 'apellido', metodo: 'NORMALIZADO', peso: 20 },
  ],
  reglas: [
    ...VIGENCIA,
    { codigo: 'SIN_CLASE_PROFESIONAL', tipo: 'OPERATIVA', severidad: 'error', mensaje: 'La licencia no habilita clases profesionales de carga.' },
  ],
};

export const VTV: Plantilla = {
  codigo: 'VTV',
  version: 1,
  nombre: 'Verificacion tecnica vehicular',
  familia: 'VEHICULAR',
  claveVencimiento: 'fechaVencimiento',
  diasAvisoVencimiento: 30,
  umbralAutoAprobacion: 0.92,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'patente', tipo: 'patente', requerido: true, critico: true, umbral: 0.95 },
    { clave: 'fechaInspeccion', tipo: 'fecha', requerido: true, critico: false, umbral: 0.9 },
    { clave: 'fechaVencimiento', tipo: 'fecha', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'resultado', tipo: 'texto', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'numeroOblea', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'taller', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'jurisdiccion', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
  ],
  clavesEmparejamiento: [
    { objeto: 'VEHICULO', campo: 'patente', metodo: 'EXACTO', peso: 90 },
  ],
  reglas: [
    ...VIGENCIA,
    PATENTE,
    { codigo: 'VERIFICACION_NO_APROBADA', tipo: 'INTRINSECA', severidad: 'critico', mensaje: 'La verificacion no figura aprobada.' },
  ],
};

export const RTO: Plantilla = {
  ...VTV,
  codigo: 'RTO',
  nombre: 'Revision tecnica obligatoria',
};

export const CEDULA_VEHICULAR: Plantilla = {
  codigo: 'CEDULA_VEHICULAR',
  version: 1,
  nombre: 'Cedula de identificacion del vehiculo',
  familia: 'VEHICULAR',
  claveVencimiento: 'fechaVencimiento',
  diasAvisoVencimiento: 60,
  umbralAutoAprobacion: 0.92,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'patente', tipo: 'patente', requerido: true, critico: true, umbral: 0.95 },
    { clave: 'marca', tipo: 'texto', requerido: true, critico: false, umbral: 0.9 },
    { clave: 'modelo', tipo: 'texto', requerido: true, critico: false, umbral: 0.9 },
    { clave: 'anio', tipo: 'numero', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'titular', tipo: 'texto', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'numeroMotor', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'numeroChasis', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'fechaVencimiento', tipo: 'fecha', requerido: false, critico: false, umbral: 0.88 },
  ],
  clavesEmparejamiento: [
    { objeto: 'VEHICULO', campo: 'patente', metodo: 'EXACTO', peso: 90 },
  ],
  reglas: [...VIGENCIA, PATENTE],
};

export const SEGURO_VEHICULAR: Plantilla = {
  codigo: 'SEGURO_VEHICULAR',
  version: 1,
  nombre: 'Poliza de seguro del vehiculo',
  familia: 'VEHICULAR',
  claveVencimiento: 'fechaVencimiento',
  diasAvisoVencimiento: 15,
  umbralAutoAprobacion: 0.92,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'patente', tipo: 'patente', requerido: true, critico: true, umbral: 0.93 },
    { clave: 'aseguradora', tipo: 'texto', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'numeroPoliza', tipo: 'texto', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'cobertura', tipo: 'texto', requerido: true, critico: false, umbral: 0.85 },
    { clave: 'tomador', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'vigenciaDesde', tipo: 'fecha', requerido: false, critico: false, umbral: 0.88 },
    { clave: 'fechaVencimiento', tipo: 'fecha', requerido: true, critico: true, umbral: 0.92 },
  ],
  clavesEmparejamiento: [
    { objeto: 'VEHICULO', campo: 'patente', metodo: 'EXACTO', peso: 90 },
  ],
  reglas: [
    ...VIGENCIA,
    PATENTE,
    { codigo: 'COBERTURA_INSUFICIENTE', tipo: 'OPERATIVA', severidad: 'error', mensaje: 'La cobertura no alcanza para transporte de carga.' },
  ],
};

export const CONSTANCIA_CUIT: Plantilla = {
  codigo: 'CONSTANCIA_CUIT',
  version: 1,
  nombre: 'Constancia de inscripcion',
  familia: 'FISCAL',
  umbralAutoAprobacion: 0.93,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'cuit', tipo: 'cuit', requerido: true, critico: true, umbral: 0.95 },
    { clave: 'razonSocial', tipo: 'texto', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'condicionIva', tipo: 'texto', requerido: true, critico: false, umbral: 0.88 },
    { clave: 'domicilioFiscal', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'actividadPrincipal', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'fechaEmision', tipo: 'fecha', requerido: false, critico: false, umbral: 0.88 },
  ],
  clavesEmparejamiento: [
    { objeto: 'PROVEEDOR', campo: 'cuit', metodo: 'EXACTO', peso: 90 },
    { objeto: 'CLIENTE', campo: 'cuit', metodo: 'EXACTO', peso: 90 },
  ],
  reglas: [CUIT, FECHA_FUTURA],
};

export const CATALOGO_LEGAL: Plantilla[] = [
  DNI,
  LICENCIA_CONDUCIR,
  VTV,
  RTO,
  CEDULA_VEHICULAR,
  SEGURO_VEHICULAR,
  CONSTANCIA_CUIT,
];
