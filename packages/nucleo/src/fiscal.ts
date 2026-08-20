import {
  ErrorArca,
  arcaConfigurado,
  codigoDeComprobante,
  comoFechaArca,
  constatarComprobante,
  partirComprobante,
  type ResultadoConstatacion,
} from '@docvance/adaptadores';
import {
  hallazgo,
  normalizarCuit,
  numero,
  type Hallazgo,
  type Plantilla,
  type ValorExtraido,
} from '@docvance/dominio';

export interface VerificacionFiscal {
  intentada: boolean;
  resultado: ResultadoConstatacion | null;
  hallazgos: Hallazgo[];
  motivoSinVerificar: string | null;
}

const SIN_VERIFICAR: VerificacionFiscal = {
  intentada: false,
  resultado: null,
  hallazgos: [],
  motivoSinVerificar: null,
};

function crudo(valores: Record<string, ValorExtraido>, clave: string): unknown {
  return valores[clave]?.valorNormalizado ?? null;
}

function noVerificable(motivo: string, campos: string[]): VerificacionFiscal {
  return {
    intentada: false,
    resultado: null,
    motivoSinVerificar: motivo,
    hallazgos: [
      hallazgo('CAE_NO_VERIFICABLE', 'advertencia', motivo, campos, 'sistema'),
    ],
  };
}

export async function verificarContraArca(
  plantilla: Plantilla,
  valores: Record<string, ValorExtraido>,
): Promise<VerificacionFiscal> {
  if (!plantilla.validacionFiscal) return SIN_VERIFICAR;

  if (!arcaConfigurado()) {
    return noVerificable('No hay credenciales de ARCA configuradas.', []);
  }

  const cae = String(crudo(valores, 'cae') ?? '').replace(/\D/g, '');
  if (!cae) {
    return noVerificable('El comprobante no tiene CAE legible.', ['cae']);
  }

  const cuitEmisor = normalizarCuit(crudo(valores, 'cuitEmisor'));
  if (!cuitEmisor) {
    return noVerificable('No se pudo leer el CUIT del emisor.', ['cuitEmisor']);
  }

  const partes = partirComprobante(crudo(valores, 'numero'));
  if (!partes) {
    return noVerificable('El numero de comprobante no tiene punto de venta y correlativo.', ['numero']);
  }

  const tipo = codigoDeComprobante(crudo(valores, 'tipoComprobante'));
  if (tipo === null) {
    return noVerificable('No se reconoce el tipo de comprobante para ARCA.', ['tipoComprobante']);
  }

  const fecha = comoFechaArca(crudo(valores, 'fechaEmision'));
  if (!fecha) {
    return noVerificable('La fecha de emision no es interpretable.', ['fechaEmision']);
  }

  const total = numero(crudo(valores, 'total'));
  if (total === null) {
    return noVerificable('El importe total no es un numero.', ['total']);
  }

  const cuitReceptor = normalizarCuit(crudo(valores, 'cuitReceptor'));

  let resultado: ResultadoConstatacion;
  try {
    resultado = await constatarComprobante({
      modo: 'CAE',
      cuitEmisor,
      puntoVenta: partes.puntoVenta,
      tipoComprobante: tipo,
      numero: partes.numero,
      fecha,
      importeTotal: total,
      codigoAutorizacion: cae,
      ...(cuitReceptor ? { tipoDocumentoReceptor: '80', numeroDocumentoReceptor: cuitReceptor } : {}),
    });
  } catch (error) {
    const e = error as ErrorArca;
    return noVerificable(`ARCA no respondio: ${e.message}`, ['cae']);
  }

  return {
    intentada: true,
    resultado,
    motivoSinVerificar: null,
    hallazgos: hallazgosDeConstatacion(resultado),
  };
}

export function hallazgosDeConstatacion(resultado: ResultadoConstatacion): Hallazgo[] {
  const detalle = [...resultado.observaciones, ...resultado.errores]
    .map((o) => `${o.codigo}: ${o.mensaje}`)
    .join(' | ');

  if (resultado.resultado === 'A') return [];

  if (resultado.resultado === 'O') {
    return [
      hallazgo(
        'CAE_OBSERVADO',
        'error',
        detalle || 'ARCA observo el comprobante sin detallar el motivo.',
        ['cae'],
        'sistema',
      ),
    ];
  }

  return [
    hallazgo(
      'CAE_RECHAZADO',
      'critico',
      detalle || 'ARCA no reconoce el comprobante con ese CAE.',
      ['cae', 'numero', 'total'],
      'sistema',
    ),
  ];
}
