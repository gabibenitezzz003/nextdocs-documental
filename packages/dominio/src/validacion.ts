import type { Hallazgo, MapaValores, Plantilla, ResultadoEmparejamiento } from './tipos.js';
import { hallazgo, severidadMaxima } from './extraccion.js';
import { cuitValido, diasEntre, fecha, numero, texto } from './valores.js';

export const DIAS_ANTIGUEDAD_ADMITIDA = 90;

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
    } else if (diasEntre(emision, ahora) > DIAS_ANTIGUEDAD_ADMITIDA) {
      agregar('FECHA_MUY_ANTIGUA', ['fechaEmision']);
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
