import type {
  FamiliaDocumento,
  Hallazgo,
  MapaValores,
  Plantilla,
  ResultadoEmparejamiento,
} from './tipos.js';
import { hallazgo, severidadMaxima } from './extraccion.js';
import { cuitValido, diasEntre, fecha, numero, patenteValida, texto } from './valores.js';

export const DIAS_ANTIGUEDAD_ADMITIDA = 90;
export const DIAS_AVISO_VENCIMIENTO = 30;

const FAMILIAS_CON_ANTIGUEDAD: FamiliaDocumento[] = ['FISCAL', 'LOGISTICO', 'COMERCIAL'];

const PALABRAS_DANIO = /(dana|roto|rotura|faltan|faltante|golpe|mojado|derrame|humedad|averi)/i;

export interface EntradaValidacion {
  plantilla: Plantilla;
  valores: MapaValores;
  observaciones: string[];
  emparejamiento: ResultadoEmparejamiento;
  ahora?: Date;
}

export interface ResultadoValidacion {
  resultado: 'LIMPIO' | 'CON_ADVERTENCIAS' | 'CON_ERRORES';
  hallazgos: Hallazgo[];
  cantidadErrores: number;
  cantidadAdvertencias: number;
  severidadMaxima: ReturnType<typeof severidadMaxima>;
}

export function validar(entrada: EntradaValidacion): ResultadoValidacion {
  const { plantilla, valores, observaciones, emparejamiento } = entrada;
  const ahora = entrada.ahora ?? new Date();
  const hallazgos: Hallazgo[] = [];

  const agregar = (codigo: string, campos: string[]) => {
    const regla = plantilla.reglas.find((r) => r.codigo === codigo);
    if (!regla) return;
    hallazgos.push(hallazgo(
      regla.codigo,
      regla.severidad,
      regla.mensaje,
      campos,
      regla.tipo === 'SEMANTICA' ? 'semantica' : 'determinista',
    ));
  };

  const valorDe = (clave: string): unknown => valores[clave]?.valorNormalizado ?? null;

  for (const campo of plantilla.campos) {
    if (campo.tipo !== 'cuit') continue;
    const valor = valorDe(campo.clave);
    if (valor && !cuitValido(valor)) agregar('CUIT_INVALIDO', [campo.clave]);
  }

  const emision = fecha(valorDe('fechaEmision'));
  if (emision) {
    if (diasEntre(ahora, emision) > 0) {
      agregar('FECHA_FUTURA', ['fechaEmision']);
    } else if (
      FAMILIAS_CON_ANTIGUEDAD.includes(plantilla.familia)
      && diasEntre(emision, ahora) > DIAS_ANTIGUEDAD_ADMITIDA
    ) {
      agregar('FECHA_MUY_ANTIGUA', ['fechaEmision']);
    }
  }

  for (const campo of plantilla.campos) {
    if (campo.tipo !== 'patente') continue;
    const valor = valorDe(campo.clave);
    if (valor && !patenteValida(valor)) agregar('PATENTE_INVALIDA', [campo.clave]);
  }

  const claveVencimiento = plantilla.claveVencimiento;
  if (claveVencimiento) {
    const vencimiento = fecha(valorDe(claveVencimiento));

    if (!vencimiento) {
      agregar('SIN_VENCIMIENTO', [claveVencimiento]);
    } else {
      const diasRestantes = diasEntre(ahora, vencimiento);
      const aviso = plantilla.diasAvisoVencimiento ?? DIAS_AVISO_VENCIMIENTO;

      if (diasRestantes < 0) agregar('VENCIDO', [claveVencimiento]);
      else if (diasRestantes <= aviso) agregar('POR_VENCER', [claveVencimiento]);
    }
  }

  if (plantilla.codigo === 'REMITO') {
    if (valorDe('conformado') === false) agregar('REMITO_SIN_CONFORMAR', ['conformado']);

    const sujeto = emparejamiento.sujeto as Record<string, unknown> | null;
    const bultosDocumento = numero(valorDe('totalBultos'));
    const bultosSujeto = sujeto ? numero(sujeto['totalBultos']) : null;
    if (bultosDocumento !== null && bultosSujeto !== null && bultosDocumento !== bultosSujeto) {
      agregar('BULTOS_NO_COINCIDEN', ['totalBultos']);
    }
  }

  if (plantilla.codigo === 'FACTURA') {
    const neto = numero(valorDe('neto'));
    const iva = numero(valorDe('iva')) ?? 0;
    const total = numero(valorDe('total'));
    if (neto !== null && total !== null) {
      const esperado = Math.round((neto + iva) * 100) / 100;
      if (Math.abs(esperado - total) > 0.05) {
        agregar('TOTAL_NO_CUADRA', ['neto', 'iva', 'total']);
      }
    }
    if (!valorDe('nroOrdenCompra')) agregar('SIN_ORDEN_COMPRA', ['nroOrdenCompra']);
  }

  if (plantilla.familia === 'VEHICULAR') {
    const resultadoInspeccion = texto(valorDe('resultado')).toUpperCase();
    if (resultadoInspeccion && !/(APROB|APTO|FAVORABLE)/.test(resultadoInspeccion)) {
      agregar('VERIFICACION_NO_APROBADA', ['resultado']);
    }

    const cobertura = texto(valorDe('cobertura')).toUpperCase();
    if (cobertura && /(RESPONSABILIDAD CIVIL BASICA|TERCEROS BASICO)/.test(cobertura)) {
      agregar('COBERTURA_INSUFICIENTE', ['cobertura']);
    }
  }

  if (plantilla.codigo === 'LICENCIA_CONDUCIR') {
    const clases = texto(valorDe('clases')).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clases && !/[CDE]/.test(clases)) agregar('SIN_CLASE_PROFESIONAL', ['clases']);
  }

  const textoObservado = `${observaciones.join(' ')} ${texto(valorDe('observaciones'))}`;
  if (PALABRAS_DANIO.test(textoObservado)) agregar('DANIO_MENCIONADO', ['observaciones']);

  const errores = hallazgos.filter((h) => h.severidad === 'error' || h.severidad === 'critico');
  const advertencias = hallazgos.filter((h) => h.severidad === 'advertencia');

  let resultado: ResultadoValidacion['resultado'] = 'LIMPIO';
  if (errores.length) resultado = 'CON_ERRORES';
  else if (advertencias.length) resultado = 'CON_ADVERTENCIAS';

  return {
    resultado,
    hallazgos,
    cantidadErrores: errores.length,
    cantidadAdvertencias: advertencias.length,
    severidadMaxima: severidadMaxima(hallazgos),
  };
}
