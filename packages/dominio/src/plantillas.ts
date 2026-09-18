import type { Plantilla } from './tipos.js';
import { CATALOGO_LEGAL } from './catalogo.js';
import { CATALOGO_LOGISTICO } from './catalogoLogistico.js';

export const REMITO: Plantilla = {
  codigo: 'REMITO',
  version: 1,
  nombre: 'Remito conformado',
  familia: 'LOGISTICO',
  umbralAutoAprobacion: 0.92,
  politicaFisica: 'REQUERIDO',
  campos: [
    { clave: 'numero', tipo: 'texto', requerido: true, critico: true, umbral: 0.9, patron: '^[0-9]{4}-[0-9]{8}$', normalizar: 'comprobante' },
    { clave: 'fechaEmision', tipo: 'fecha', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'cuitEmisor', tipo: 'cuit', requerido: true, critico: true, umbral: 0.95 },
    { clave: 'razonSocialEmisor', tipo: 'texto', requerido: true, critico: false, umbral: 0.85 },
    { clave: 'cuitDestinatario', tipo: 'cuit', requerido: false, critico: false, umbral: 0.9 },
    { clave: 'razonSocialDestinatario', tipo: 'texto', requerido: true, critico: true, umbral: 0.85 },
    { clave: 'domicilioEntrega', tipo: 'texto', requerido: true, critico: false, umbral: 0.8 },
    { clave: 'nroPedido', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'patente', tipo: 'patente', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'totalBultos', tipo: 'numero', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'pesoTotal', tipo: 'numero', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'conformado', tipo: 'booleano', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'observaciones', tipo: 'texto', requerido: false, critico: false, umbral: 0.6 },
  ],
  tabla: { clave: 'items', columnas: ['descripcion', 'codigo', 'cantidad', 'unidad'] },
  clavesEmparejamiento: [
    { objeto: 'PEDIDO', campo: 'nroPedido', metodo: 'EXACTO', peso: 70 },
    { objeto: 'PEDIDO', campo: 'numero', metodo: 'COMPROBANTE', peso: 50 },
    { objeto: 'CLIENTE', campo: 'cuitDestinatario', metodo: 'EXACTO', peso: 30 },
    { objeto: 'CLIENTE', campo: 'razonSocialDestinatario', metodo: 'NORMALIZADO', peso: 15 },
    { objeto: 'VEHICULO', campo: 'patente', metodo: 'EXACTO', peso: 10 },
  ],
  reglas: [
    { codigo: 'REMITO_SIN_CONFORMAR', tipo: 'INTRINSECA', severidad: 'error', mensaje: 'El remito no figura conformado por el destinatario.' },
    { codigo: 'FECHA_FUTURA', tipo: 'TEMPORAL', severidad: 'error', mensaje: 'La fecha de emision es posterior a hoy.' },
    { codigo: 'FECHA_MUY_ANTIGUA', tipo: 'TEMPORAL', severidad: 'advertencia', mensaje: 'La fecha de emision tiene mas de 90 dias.' },
    { codigo: 'CUIT_INVALIDO', tipo: 'INTRINSECA', severidad: 'error', mensaje: 'El CUIT no supera la validacion de digito verificador.' },
    { codigo: 'BULTOS_NO_COINCIDEN', tipo: 'CRUZADA', severidad: 'advertencia', mensaje: 'Los bultos del remito no coinciden con los del pedido.' },
    { codigo: 'DANIO_MENCIONADO', tipo: 'SEMANTICA', severidad: 'advertencia', mensaje: 'El documento menciona mercaderia danada o faltante.' },
  ],
};

export const FACTURA: Plantilla = {
  codigo: 'FACTURA',
  version: 1,
  nombre: 'Factura de compra',
  familia: 'FISCAL',
  umbralAutoAprobacion: 0.95,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'numero', tipo: 'texto', requerido: true, critico: true, umbral: 0.95, patron: '^[0-9]{4}-[0-9]{8}$', normalizar: 'comprobante' },
    { clave: 'tipoComprobante', tipo: 'texto', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'fechaEmision', tipo: 'fecha', requerido: true, critico: true, umbral: 0.95 },
    { clave: 'cuitEmisor', tipo: 'cuit', requerido: true, critico: true, umbral: 0.95 },
    { clave: 'razonSocialEmisor', tipo: 'texto', requerido: true, critico: false, umbral: 0.85 },
    { clave: 'cae', tipo: 'texto', requerido: false, critico: false, umbral: 0.9 },
    { clave: 'neto', tipo: 'numero', requerido: true, critico: true, umbral: 0.95 },
    { clave: 'iva', tipo: 'numero', requerido: false, critico: false, umbral: 0.9 },
    { clave: 'total', tipo: 'numero', requerido: true, critico: true, umbral: 0.95 },
    { clave: 'nroOrdenCompra', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'cuitReceptor', tipo: 'cuit', requerido: false, critico: false, umbral: 0.9 },
  ],
  tabla: { clave: 'items', columnas: ['descripcion', 'cantidad', 'precioUnitario', 'importe'] },
  clavesEmparejamiento: [
    { objeto: 'ORDEN_COMPRA', campo: 'nroOrdenCompra', metodo: 'EXACTO', peso: 70 },
    { objeto: 'PROVEEDOR', campo: 'cuitEmisor', metodo: 'EXACTO', peso: 40 },
  ],
  reglas: [
    { codigo: 'TOTAL_NO_CUADRA', tipo: 'INTRINSECA', severidad: 'error', mensaje: 'El total no coincide con la suma de neto e iva.' },
    { codigo: 'CUIT_INVALIDO', tipo: 'INTRINSECA', severidad: 'error', mensaje: 'El CUIT no supera la validacion de digito verificador.' },
    { codigo: 'FECHA_FUTURA', tipo: 'TEMPORAL', severidad: 'error', mensaje: 'La fecha de emision es posterior a hoy.' },
    { codigo: 'SIN_ORDEN_COMPRA', tipo: 'OPERATIVA', severidad: 'advertencia', mensaje: 'La factura no referencia una orden de compra.' },
    { codigo: 'CAE_RECHAZADO', tipo: 'MAESTROS', severidad: 'critico', mensaje: 'ARCA no reconoce el comprobante con ese CAE.' },
    { codigo: 'CAE_OBSERVADO', tipo: 'MAESTROS', severidad: 'error', mensaje: 'ARCA observo el comprobante.' },
    { codigo: 'CAE_NO_VERIFICABLE', tipo: 'MAESTROS', severidad: 'advertencia', mensaje: 'No se pudo constatar el comprobante contra ARCA.' },
  ],
  validacionFiscal: true,
};

export const NOTA_CREDITO: Plantilla = {
  ...FACTURA,
  codigo: 'NOTA_CREDITO',
  nombre: 'Nota de credito',
  clavesEmparejamiento: [
    { objeto: 'FACTURA', campo: 'comprobanteAsociado', metodo: 'COMPROBANTE', peso: 70 },
    { objeto: 'PROVEEDOR', campo: 'cuitEmisor', metodo: 'EXACTO', peso: 40 },
  ],
};

export const NOTA_DEBITO: Plantilla = {
  ...NOTA_CREDITO,
  codigo: 'NOTA_DEBITO',
  nombre: 'Nota de debito',
};

export const PLANTILLAS_BASE: Record<string, Plantilla> = Object.fromEntries(
  [REMITO, FACTURA, NOTA_CREDITO, NOTA_DEBITO, ...CATALOGO_LEGAL, ...CATALOGO_LOGISTICO].map((p) => [p.codigo, p]),
);

export function plantillaDe(codigo: string): Plantilla | null {
  return PLANTILLAS_BASE[String(codigo ?? '').toUpperCase().replace(/[\s-]+/g, '_')] ?? null;
}

export function plantillasDeFamilia(familia: Plantilla['familia']): Plantilla[] {
  return Object.values(PLANTILLAS_BASE).filter((p) => p.familia === familia);
}
