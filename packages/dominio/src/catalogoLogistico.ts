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

export const ORDEN_CARGA: Plantilla = {
  codigo: 'ORDEN_CARGA',
  version: 1,
  nombre: 'Orden de carga / solicitud de servicio',
  familia: 'LOGISTICO',
  umbralAutoAprobacion: 0.93,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'numeroOrden', tipo: 'texto', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'fechaEmision', tipo: 'fecha', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'cuitCliente', tipo: 'cuit', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'razonSocialCliente', tipo: 'texto', requerido: true, critico: true, umbral: 0.88 },
    { clave: 'remitente', tipo: 'texto', requerido: true, critico: false, umbral: 0.85 },
    { clave: 'destinatario', tipo: 'texto', requerido: true, critico: true, umbral: 0.85 },
    { clave: 'domicilioOrigen', tipo: 'texto', requerido: true, critico: false, umbral: 0.8 },
    { clave: 'domicilioDestino', tipo: 'texto', requerido: true, critico: false, umbral: 0.8 },
    { clave: 'descripcionMercaderia', tipo: 'texto', requerido: true, critico: false, umbral: 0.8 },
    { clave: 'cantidad', tipo: 'numero', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'pesoTotal', tipo: 'numero', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'precio', tipo: 'numero', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'condiciones', tipo: 'texto', requerido: false, critico: false, umbral: 0.6 },
    { clave: 'fechaRetiroEstimada', tipo: 'fecha', requerido: false, critico: false, umbral: 0.85 },
  ],
  clavesEmparejamiento: [
    { objeto: 'VIAJE', campo: 'numeroOrden', metodo: 'EXACTO', peso: 90 },
    { objeto: 'CLIENTE', campo: 'cuitCliente', metodo: 'EXACTO', peso: 40 },
  ],
  reglas: [CUIT, FECHA_FUTURA],
};

export const HABILITACION_TRANSPORTISTA: Plantilla = {
  codigo: 'HABILITACION_TRANSPORTISTA',
  version: 1,
  nombre: 'Habilitacion del transportista',
  familia: 'HABILITANTE',
  claveVencimiento: 'fechaVencimiento',
  diasAvisoVencimiento: 30,
  umbralAutoAprobacion: 0.92,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'cuit', tipo: 'cuit', requerido: true, critico: true, umbral: 0.93 },
    { clave: 'razonSocial', tipo: 'texto', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'tipoHabilitacion', tipo: 'texto', requerido: true, critico: true, umbral: 0.88 },
    { clave: 'numeroHabilitacion', tipo: 'texto', requerido: true, critico: false, umbral: 0.88 },
    { clave: 'organismo', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'fechaEmision', tipo: 'fecha', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'fechaVencimiento', tipo: 'fecha', requerido: false, critico: false, umbral: 0.88 },
  ],
  clavesEmparejamiento: [
    { objeto: 'TRANSPORTISTA', campo: 'cuit', metodo: 'EXACTO', peso: 90 },
    { objeto: 'PROVEEDOR', campo: 'cuit', metodo: 'EXACTO', peso: 60 },
  ],
  reglas: [...VIGENCIA, CUIT],
};

export const CARTA_PORTE: Plantilla = {
  codigo: 'CARTA_PORTE',
  version: 1,
  nombre: 'Carta de porte / documento de transporte',
  familia: 'LOGISTICO',
  umbralAutoAprobacion: 0.92,
  politicaFisica: 'REQUERIDO',
  campos: [
    { clave: 'numero', tipo: 'texto', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'fechaEmision', tipo: 'fecha', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'cuitEmisor', tipo: 'cuit', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'remitente', tipo: 'texto', requerido: true, critico: false, umbral: 0.85 },
    { clave: 'destinatario', tipo: 'texto', requerido: true, critico: true, umbral: 0.85 },
    { clave: 'domicilioOrigen', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'domicilioDestino', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'descripcionMercaderia', tipo: 'texto', requerido: true, critico: false, umbral: 0.8 },
    { clave: 'cantidad', tipo: 'numero', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'patente', tipo: 'patente', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'numeroOrden', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
  ],
  clavesEmparejamiento: [
    { objeto: 'VIAJE', campo: 'numeroOrden', metodo: 'EXACTO', peso: 80 },
    { objeto: 'VEHICULO', campo: 'patente', metodo: 'EXACTO', peso: 30 },
  ],
  reglas: [CUIT, FECHA_FUTURA, PATENTE],
};

export const REMITO_ELECTRONICO: Plantilla = {
  codigo: 'REMITO_ELECTRONICO',
  version: 1,
  nombre: 'Remito electronico',
  familia: 'LOGISTICO',
  umbralAutoAprobacion: 0.92,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'numero', tipo: 'texto', requerido: true, critico: true, umbral: 0.9, patron: '^[0-9]{4}-[0-9]{8}$', normalizar: 'comprobante' },
    { clave: 'fechaEmision', tipo: 'fecha', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'cuitEmisor', tipo: 'cuit', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'destinatario', tipo: 'texto', requerido: true, critico: true, umbral: 0.85 },
    { clave: 'domicilioEntrega', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'descripcionMercaderia', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'totalBultos', tipo: 'numero', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'codigoAutorizacion', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
  ],
  clavesEmparejamiento: [
    { objeto: 'VIAJE', campo: 'numero', metodo: 'COMPROBANTE', peso: 60 },
    { objeto: 'VIAJE', campo: 'numeroOrden', metodo: 'EXACTO', peso: 50 },
  ],
  reglas: [CUIT, FECHA_FUTURA],
};

export const CERTIFICADO_ORIGEN: Plantilla = {
  codigo: 'CERTIFICADO_ORIGEN',
  version: 1,
  nombre: 'Certificado de origen de mercaderia',
  familia: 'COMERCIAL',
  umbralAutoAprobacion: 0.92,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'numeroCertificado', tipo: 'texto', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'fechaEmision', tipo: 'fecha', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'paisOrigen', tipo: 'texto', requerido: true, critico: true, umbral: 0.88 },
    { clave: 'descripcionMercaderia', tipo: 'texto', requerido: true, critico: false, umbral: 0.8 },
    { clave: 'cantidad', tipo: 'numero', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'remitente', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'destinatario', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'autoridad', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
  ],
  clavesEmparejamiento: [
    { objeto: 'VIAJE', campo: 'numeroOrden', metodo: 'EXACTO', peso: 40 },
  ],
  reglas: [FECHA_FUTURA],
};

export const FICHA_SEGURIDAD: Plantilla = {
  codigo: 'FICHA_SEGURIDAD',
  version: 1,
  nombre: 'Ficha / hoja de seguridad de mercaderia',
  familia: 'HABILITANTE',
  umbralAutoAprobacion: 0.9,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'producto', tipo: 'texto', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'fabricante', tipo: 'texto', requerido: true, critico: false, umbral: 0.85 },
    { clave: 'clasePeligro', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'numeroOnu', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'numeroVersion', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'fechaEmision', tipo: 'fecha', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'fechaRevision', tipo: 'fecha', requerido: false, critico: false, umbral: 0.85 },
  ],
  clavesEmparejamiento: [],
  reglas: [FECHA_FUTURA],
};

export const COMPROBANTE_RETIRO: Plantilla = {
  codigo: 'COMPROBANTE_RETIRO',
  version: 1,
  nombre: 'Comprobante de retiro en origen',
  familia: 'LOGISTICO',
  umbralAutoAprobacion: 0.9,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'fechaRetiro', tipo: 'fecha', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'remitente', tipo: 'texto', requerido: true, critico: false, umbral: 0.85 },
    { clave: 'domicilioRetiro', tipo: 'texto', requerido: true, critico: false, umbral: 0.8 },
    { clave: 'descripcionMercaderia', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'cantidad', tipo: 'numero', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'patente', tipo: 'patente', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'nombreChofer', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'numeroDocumentoChofer', tipo: 'documento', requerido: false, critico: false, umbral: 0.88 },
    { clave: 'firmado', tipo: 'booleano', requerido: true, critico: true, umbral: 0.9 },
  ],
  clavesEmparejamiento: [
    { objeto: 'VIAJE', campo: 'numeroOrden', metodo: 'EXACTO', peso: 50 },
    { objeto: 'VEHICULO', campo: 'patente', metodo: 'EXACTO', peso: 30 },
  ],
  reglas: [
    FECHA_FUTURA,
    PATENTE,
    { codigo: 'RETIRO_SIN_FIRMA', tipo: 'INTRINSECA', severidad: 'error', mensaje: 'El comprobante de retiro no figura firmado.' },
  ],
};

export const EVIDENCIA_FOTOGRAFICA: Plantilla = {
  codigo: 'EVIDENCIA_FOTOGRAFICA',
  version: 1,
  nombre: 'Registro fotografico / evidencia',
  familia: 'LOGISTICO',
  umbralAutoAprobacion: 0.85,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'fecha', tipo: 'fecha', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'sujeto', tipo: 'texto', requerido: false, critico: false, umbral: 0.7 },
    { clave: 'descripcion', tipo: 'texto', requerido: false, critico: false, umbral: 0.6 },
  ],
  clavesEmparejamiento: [
    { objeto: 'VIAJE', campo: 'numeroOrden', metodo: 'EXACTO', peso: 30 },
  ],
  reglas: [],
};

export const CONSTANCIA_ENTREGA: Plantilla = {
  codigo: 'CONSTANCIA_ENTREGA',
  version: 1,
  nombre: 'Constancia de entrega / recepcion',
  familia: 'LOGISTICO',
  umbralAutoAprobacion: 0.9,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'fechaEntrega', tipo: 'fecha', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'destinatario', tipo: 'texto', requerido: true, critico: true, umbral: 0.85 },
    { clave: 'domicilioEntrega', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'cantidad', tipo: 'numero', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'firmado', tipo: 'booleano', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'observaciones', tipo: 'texto', requerido: false, critico: false, umbral: 0.6 },
  ],
  clavesEmparejamiento: [
    { objeto: 'VIAJE', campo: 'numeroOrden', metodo: 'EXACTO', peso: 60 },
  ],
  reglas: [
    FECHA_FUTURA,
    { codigo: 'ENTREGA_SIN_FIRMA', tipo: 'INTRINSECA', severidad: 'error', mensaje: 'La constancia de entrega no figura firmada.' },
    { codigo: 'DANIO_MENCIONADO', tipo: 'SEMANTICA', severidad: 'advertencia', mensaje: 'El documento menciona mercaderia danada o faltante.' },
  ],
};

export const PLANILLA_VIAJE: Plantilla = {
  codigo: 'PLANILLA_VIAJE',
  version: 1,
  nombre: 'Planilla de viaje',
  familia: 'LOGISTICO',
  umbralAutoAprobacion: 0.9,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'numeroViaje', tipo: 'texto', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'fecha', tipo: 'fecha', requerido: true, critico: false, umbral: 0.88 },
    { clave: 'patente', tipo: 'patente', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'nombreChofer', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'kilometros', tipo: 'numero', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'diasEstadia', tipo: 'numero', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'adicionales', tipo: 'numero', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'total', tipo: 'numero', requerido: true, critico: true, umbral: 0.9 },
  ],
  clavesEmparejamiento: [
    { objeto: 'VIAJE', campo: 'numeroViaje', metodo: 'EXACTO', peso: 80 },
    { objeto: 'VEHICULO', campo: 'patente', metodo: 'EXACTO', peso: 30 },
  ],
  reglas: [PATENTE],
};

export const LIQUIDACION_TRANSPORTISTA: Plantilla = {
  codigo: 'LIQUIDACION_TRANSPORTISTA',
  version: 1,
  nombre: 'Liquidacion del transportista',
  familia: 'COMERCIAL',
  umbralAutoAprobacion: 0.92,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'numeroLiquidacion', tipo: 'texto', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'fechaEmision', tipo: 'fecha', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'cuitTransportista', tipo: 'cuit', requerido: true, critico: true, umbral: 0.93 },
    { clave: 'razonSocialTransportista', tipo: 'texto', requerido: true, critico: false, umbral: 0.88 },
    { clave: 'periodo', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'numeroViaje', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'subtotal', tipo: 'numero', requerido: true, critico: false, umbral: 0.9 },
    { clave: 'adicionales', tipo: 'numero', requerido: false, critico: false, umbral: 0.88 },
    { clave: 'deducciones', tipo: 'numero', requerido: false, critico: false, umbral: 0.88 },
    { clave: 'total', tipo: 'numero', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'estado', tipo: 'texto', requerido: true, critico: true, umbral: 0.9 },
  ],
  tabla: { clave: 'conceptos', columnas: ['descripcion', 'cantidad', 'precioUnitario', 'importe'] },
  clavesEmparejamiento: [
    { objeto: 'TRANSPORTISTA', campo: 'cuitTransportista', metodo: 'EXACTO', peso: 80 },
    { objeto: 'VIAJE', campo: 'numeroViaje', metodo: 'EXACTO', peso: 50 },
  ],
  reglas: [
    CUIT,
    FECHA_FUTURA,
    { codigo: 'TOTAL_NO_CUADRA', tipo: 'INTRINSECA', severidad: 'error', mensaje: 'El total no coincide con subtotal, adicionales y deducciones.' },
    { codigo: 'LIQUIDACION_NO_APROBADA', tipo: 'OPERATIVA', severidad: 'error', mensaje: 'La liquidacion no figura aprobada.' },
  ],
};

export const ORDEN_PAGO: Plantilla = {
  codigo: 'ORDEN_PAGO',
  version: 1,
  nombre: 'Orden de pago',
  familia: 'FISCAL',
  umbralAutoAprobacion: 0.92,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'numeroOrdenPago', tipo: 'texto', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'fechaEmision', tipo: 'fecha', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'cuitBeneficiario', tipo: 'cuit', requerido: true, critico: true, umbral: 0.93 },
    { clave: 'razonSocialBeneficiario', tipo: 'texto', requerido: true, critico: false, umbral: 0.88 },
    { clave: 'importe', tipo: 'numero', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'concepto', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'banco', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'cbu', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
  ],
  clavesEmparejamiento: [
    { objeto: 'TRANSPORTISTA', campo: 'cuitBeneficiario', metodo: 'EXACTO', peso: 80 },
    { objeto: 'PROVEEDOR', campo: 'cuitBeneficiario', metodo: 'EXACTO', peso: 60 },
  ],
  reglas: [CUIT, FECHA_FUTURA],
};

export const COMPROBANTE_TRANSFERENCIA: Plantilla = {
  codigo: 'COMPROBANTE_TRANSFERENCIA',
  version: 1,
  nombre: 'Comprobante de transferencia bancaria',
  familia: 'FISCAL',
  umbralAutoAprobacion: 0.92,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'numeroOperacion', tipo: 'texto', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'fecha', tipo: 'fecha', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'importe', tipo: 'numero', requerido: true, critico: true, umbral: 0.92 },
    { clave: 'cuitOrigen', tipo: 'cuit', requerido: false, critico: false, umbral: 0.9 },
    { clave: 'cuitDestino', tipo: 'cuit', requerido: true, critico: true, umbral: 0.93 },
    { clave: 'bancoOrigen', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'bancoDestino', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'cbuDestino', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'referencia', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
  ],
  clavesEmparejamiento: [
    { objeto: 'TRANSPORTISTA', campo: 'cuitDestino', metodo: 'EXACTO', peso: 80 },
    { objeto: 'ORDEN_PAGO', campo: 'referencia', metodo: 'EXACTO', peso: 40 },
  ],
  reglas: [CUIT, FECHA_FUTURA],
};

export const ESTADO_CUENTA: Plantilla = {
  codigo: 'ESTADO_CUENTA',
  version: 1,
  nombre: 'Estado de cuenta / movimiento bancario',
  familia: 'FISCAL',
  umbralAutoAprobacion: 0.9,
  politicaFisica: 'NO_REQUERIDO',
  campos: [
    { clave: 'banco', tipo: 'texto', requerido: true, critico: true, umbral: 0.9 },
    { clave: 'numeroCuenta', tipo: 'texto', requerido: true, critico: false, umbral: 0.88 },
    { clave: 'titular', tipo: 'texto', requerido: true, critico: false, umbral: 0.85 },
    { clave: 'periodo', tipo: 'texto', requerido: false, critico: false, umbral: 0.8 },
    { clave: 'saldoInicial', tipo: 'numero', requerido: false, critico: false, umbral: 0.88 },
    { clave: 'saldoFinal', tipo: 'numero', requerido: false, critico: false, umbral: 0.88 },
  ],
  tabla: { clave: 'movimientos', columnas: ['fecha', 'descripcion', 'referencia', 'debito', 'credito', 'saldo'] },
  clavesEmparejamiento: [],
  reglas: [],
};

export const FACTURA_TRANSPORTISTA: Plantilla = {
  codigo: 'FACTURA_TRANSPORTISTA',
  version: 1,
  nombre: 'Factura del transportista',
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
    { clave: 'numeroLiquidacion', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'numeroViaje', tipo: 'texto', requerido: false, critico: false, umbral: 0.85 },
    { clave: 'cuitReceptor', tipo: 'cuit', requerido: false, critico: false, umbral: 0.9 },
  ],
  tabla: { clave: 'items', columnas: ['descripcion', 'cantidad', 'precioUnitario', 'importe'] },
  clavesEmparejamiento: [
    { objeto: 'TRANSPORTISTA', campo: 'cuitEmisor', metodo: 'EXACTO', peso: 70 },
    { objeto: 'LIQUIDACION', campo: 'numeroLiquidacion', metodo: 'EXACTO', peso: 60 },
    { objeto: 'VIAJE', campo: 'numeroViaje', metodo: 'EXACTO', peso: 40 },
  ],
  reglas: [
    { codigo: 'TOTAL_NO_CUADRA', tipo: 'INTRINSECA', severidad: 'error', mensaje: 'El total no coincide con la suma de neto e iva.' },
    CUIT,
    FECHA_FUTURA,
    { codigo: 'SIN_LIQUIDACION', tipo: 'OPERATIVA', severidad: 'advertencia', mensaje: 'La factura no referencia una liquidacion del transportista.' },
    { codigo: 'CAE_RECHAZADO', tipo: 'MAESTROS', severidad: 'critico', mensaje: 'ARCA no reconoce el comprobante con ese CAE.' },
    { codigo: 'CAE_OBSERVADO', tipo: 'MAESTROS', severidad: 'error', mensaje: 'ARCA observo el comprobante.' },
    { codigo: 'CAE_NO_VERIFICABLE', tipo: 'MAESTROS', severidad: 'advertencia', mensaje: 'No se pudo constatar el comprobante contra ARCA.' },
  ],
  validacionFiscal: true,
};

export const CATALOGO_LOGISTICO: Plantilla[] = [
  ORDEN_CARGA,
  HABILITACION_TRANSPORTISTA,
  CARTA_PORTE,
  REMITO_ELECTRONICO,
  CERTIFICADO_ORIGEN,
  FICHA_SEGURIDAD,
  COMPROBANTE_RETIRO,
  EVIDENCIA_FOTOGRAFICA,
  CONSTANCIA_ENTREGA,
  PLANILLA_VIAJE,
  LIQUIDACION_TRANSPORTISTA,
  ORDEN_PAGO,
  COMPROBANTE_TRANSFERENCIA,
  ESTADO_CUENTA,
  FACTURA_TRANSPORTISTA,
];
